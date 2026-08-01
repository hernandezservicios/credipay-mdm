/**
 * ==============================================================================
 * SERVICIO API REST NODE.JS / EXPRESS CON CONEXIÓN MYSQL (HOSTINGER)
 * Sistema: CrediPay MDM & InovaGuard MDM
 * Descripción: Permite reemplazar las variables estáticas iniciales del frontend
 *              por datos reales persistidos en base de datos MySQL de Hostinger.
 * ==============================================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3001;

// 1. Configuración de middlewares
app.use(cors());
app.use(express.json());

// 2. Creación del Pool de Conexiones MySQL (Compatible con Hostinger cPanel / VPS)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'uXXXXX_mdm_credipay',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
});

// Verificación inicial de conexión a Hostinger DB
pool.getConnection()
  .then((conn) => {
    console.log(`✅ Conexión exitosa a MySQL Hostinger [DB: ${process.env.DB_NAME || 'local'}]`);
    conn.release();
  })
  .catch((err) => {
    console.error('❌ Error al conectar con la base de datos MySQL en Hostinger:', err.message);
  });

// ==============================================================================
// 3. RUTAS DE LA API (REEMPLAZO DE LOS DATOS INICIALES DEL FRONTEND)
// ==============================================================================

/**
 * GET /api/clients
 * Obtiene todos los clientes con su dispositivo y cuotas para renderizar en React
 */
app.get('/api/clients', async (req, res) => {
  try {
    const [clientRows] = await pool.query('SELECT * FROM clientes ORDER BY created_at DESC');
    const [deviceRows] = await pool.query('SELECT * FROM dispositivos');
    const [installmentRows] = await pool.query('SELECT * FROM cuotas ORDER BY number ASC');

    // Mapear al formato ClientCredit esperado por el frontend
    const clients = clientRows.map((cli) => {
      const dev = deviceRows.find((d) => d.client_id === cli.id) || {
        imei: '000000000000000',
        model: 'Sin Dispositivo',
        mdm_status: 'UNLOCKED',
      };

      const insts = installmentRows
        .filter((c) => c.client_id === cli.id)
        .map((c) => ({
          id: c.id,
          number: c.number,
          dueDate: c.due_date instanceof Date ? c.due_date.toISOString().split('T')[0] : String(c.due_date),
          amount: Number(c.amount),
          lateFee: Number(c.late_fee),
          status: c.status,
          paidAt: c.paid_at ? new Date(c.paid_at).toISOString() : undefined,
        }));

      return {
        id: cli.id,
        fullName: cli.full_name,
        phone: cli.phone,
        email: cli.email || undefined,
        creditAmount: Number(cli.credit_amount),
        balanceDue: Number(cli.balance_due),
        daysOverdue: Number(cli.days_overdue),
        status: cli.status,
        device: {
          id: dev.id,
          inovaguardId: dev.inovaguard_id || undefined,
          imei: dev.imei,
          model: dev.model,
          mdmStatus: dev.mdm_status,
          lastMdmSync: dev.last_mdm_sync || 'Conectado a MySQL Hostinger',
          lastUnlockCode: dev.last_unlock_code || undefined,
        },
        installments: insts,
      };
    });

    return res.json({ success: true, count: clients.length, clients });
  } catch (error) {
    console.error('Error GET /api/clients:', error);
    return res.status(500).json({ success: false, error: 'Error al consultar MySQL de Hostinger' });
  }
});

/**
 * POST /api/clients
 * Crea un nuevo cliente + dispositivo + cuotas en MySQL (reemplaza agregar en memoria)
 */
app.post('/api/clients', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      id,
      fullName,
      phone,
      email,
      creditAmount,
      balanceDue,
      deviceImei,
      deviceModel,
      installments,
    } = req.body;

    // 1. Insertar Cliente
    await connection.execute(
      `INSERT INTO clientes (id, full_name, phone, email, credit_amount, balance_due, days_overdue, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'AL_DIA')`,
      [id, fullName, phone, email || null, creditAmount, balanceDue, 0]
    );

    // 2. Insertar Dispositivo
    const deviceId = `DEV-${id}`;
    await connection.execute(
      `INSERT INTO dispositivos (id, client_id, imei, model, mdm_status, last_mdm_sync)
       VALUES (?, ?, ?, ?, 'UNLOCKED', 'Recién dado de alta en MySQL Hostinger')`,
      [deviceId, id, deviceImei, deviceModel]
    );

    // 3. Insertar Cuotas
    if (Array.isArray(installments)) {
      for (const inst of installments) {
        await connection.execute(
          `INSERT INTO cuotas (id, client_id, number, due_date, amount, late_fee, status)
           VALUES (?, ?, ?, ?, ?, 0.00, 'PENDING')`,
          [inst.id, id, inst.number, inst.dueDate, inst.amount]
        );
      }
    }

    await connection.commit();
    return res.status(201).json({ success: true, message: 'Cliente y crédito persistido en Hostinger DB' });
  } catch (error) {
    await connection.rollback();
    console.error('Error POST /api/clients:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/clients/:clientId/installments/:installmentId/pay
 * Registra el pago de una cuota en la base de datos de Hostinger
 */
app.put('/api/clients/:clientId/installments/:installmentId/pay', async (req, res) => {
  const { clientId, installmentId } = req.params;
  try {
    const paidAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
      `UPDATE cuotas SET status = 'PAID', paid_at = ? WHERE id = ? AND client_id = ?`,
      [paidAt, installmentId, clientId]
    );

    // Actualizar saldo del cliente
    await pool.execute(
      `UPDATE clientes SET balance_due = GREATEST(0, balance_due - (
         SELECT amount + late_fee FROM cuotas WHERE id = ?
       )) WHERE id = ?`,
      [installmentId, clientId]
    );

    return res.json({ success: true, message: 'Cuota pagada en MySQL Hostinger' });
  } catch (error) {
    console.error('Error al pagar cuota:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/devices/:imei/mdm-status
 * Actualiza el estado de bloqueo/desbloqueo de un dispositivo celular
 */
app.put('/api/devices/:imei/mdm-status', async (req, res) => {
  const { imei } = req.params;
  const { status, lastSync, unlockCode } = req.body; // 'LOCKED' | 'UNLOCKED'
  try {
    await pool.execute(
      `UPDATE dispositivos
       SET mdm_status = ?, last_mdm_sync = ?, last_unlock_code = COALESCE(?, last_unlock_code)
       WHERE imei = ?`,
      [status, lastSync || `Estado actualizado a ${status}`, unlockCode || null, imei]
    );

    return res.json({ success: true, message: `Estado MDM cambiado a ${status} para IMEI ${imei}` });
  } catch (error) {
    console.error('Error al actualizar MDM:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/logs
 * Obtiene el historial inmutable de auditoría MDM desde MySQL
 */
app.get('/api/logs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM mdm_logs ORDER BY created_at DESC LIMIT 100');
    return res.json({ success: true, count: rows.length, logs: rows });
  } catch (error) {
    console.error('Error GET /api/logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/logs
 * Agrega un nuevo evento de auditoría en la base de datos MySQL
 */
app.post('/api/logs', async (req, res) => {
  const { id, clientId, clientName, imei, action, trigger, details } = req.body;
  try {
    await pool.execute(
      `INSERT INTO mdm_logs (id, client_id, client_name, imei, action, trigger_type, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id || `LOG-${Date.now()}`,
        clientId || null,
        clientName,
        imei,
        action,
        trigger,
        details,
      ]
    );
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Error POST /api/logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Iniciar Servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor API de CrediPay MDM corriendo en http://localhost:${PORT}`);
  console.log(`💡 En Hostinger, este archivo puede correr vía 'Node.js Selector' de hPanel o un VPS Linux.`);
});
