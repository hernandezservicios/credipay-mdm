import React, { useState } from 'react';
import { Database, Copy, Check, X, Server, Shield, FileCode, ExternalLink } from 'lucide-react';

interface HostingerSqlModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SQL_SCHEMA_TEXT = `-- ==============================================================================
-- ESQUEMA DE BASE DE DATOS MySQL (COMPATIBLE CON HOSTINGER / cPANEL / VPS)
-- SISTEMA: CrediPay MDM & InovaGuard MDM
-- Versión: 1.0 PROD
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS \`mdm_logs\`;
DROP TABLE IF EXISTS \`cuotas\`;
DROP TABLE IF EXISTS \`dispositivos\`;
DROP TABLE IF EXISTS \`clientes\`;
DROP TABLE IF EXISTS \`mdm_configuracion\`;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. CONFIGURACIÓN GLOBAL MDM
CREATE TABLE IF NOT EXISTS \`mdm_configuracion\` (
  \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`app_client\` VARCHAR(100) NOT NULL COMMENT 'ID de empresa en InovaGuard',
  \`username\` VARCHAR(150) NOT NULL COMMENT 'Usuario InovaGuard',
  \`api_key\` VARCHAR(255) NOT NULL COMMENT 'Token REST InovaGuard',
  \`base_url\` VARCHAR(255) DEFAULT 'https://inovaguard.net',
  \`auto_engine_active\` TINYINT(1) DEFAULT 1,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. TABLA DE CLIENTES (TITULARES DEL CRÉDITO)
CREATE TABLE IF NOT EXISTS \`clientes\` (
  \`id\` VARCHAR(50) NOT NULL PRIMARY KEY COMMENT 'CLI-001, CLI-002...',
  \`full_name\` VARCHAR(150) NOT NULL,
  \`phone\` VARCHAR(30) NOT NULL,
  \`email\` VARCHAR(120) NULL,
  \`credit_amount\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  \`balance_due\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  \`days_overdue\` INT NOT NULL DEFAULT 0,
  \`status\` ENUM('AL_DIA', 'ATRASADO', 'VENCIDO') NOT NULL DEFAULT 'AL_DIA',
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX \`idx_status\` (\`status\`),
  INDEX \`idx_phone\` (\`phone\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. TABLA DE DISPOSITIVOS (PARQUE INOVAGUARD MDM)
CREATE TABLE IF NOT EXISTS \`dispositivos\` (
  \`id\` VARCHAR(50) NOT NULL PRIMARY KEY,
  \`client_id\` VARCHAR(50) NOT NULL,
  \`inovaguard_id\` VARCHAR(80) NULL,
  \`imei\` VARCHAR(30) NOT NULL UNIQUE,
  \`model\` VARCHAR(100) NOT NULL,
  \`mdm_status\` ENUM('LOCKED', 'UNLOCKED', 'PENDING') NOT NULL DEFAULT 'UNLOCKED',
  \`last_mdm_sync\` VARCHAR(255) NULL,
  \`last_unlock_code\` VARCHAR(20) NULL,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT \`fk_dispositivo_cliente\` FOREIGN KEY (\`client_id\`)
    REFERENCES \`clientes\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX \`idx_imei\` (\`imei\`),
  INDEX \`idx_inovaguard_id\` (\`inovaguard_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TABLA DE CUOTAS / AMORTIZACIÓN
CREATE TABLE IF NOT EXISTS \`cuotas\` (
  \`id\` VARCHAR(50) NOT NULL PRIMARY KEY,
  \`client_id\` VARCHAR(50) NOT NULL,
  \`number\` INT UNSIGNED NOT NULL,
  \`due_date\` DATE NOT NULL,
  \`amount\` DECIMAL(10, 2) NOT NULL,
  \`late_fee\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  \`status\` ENUM('PAID', 'PENDING', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
  \`paid_at\` DATETIME NULL,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT \`fk_cuota_cliente\` FOREIGN KEY (\`client_id\`)
    REFERENCES \`clientes\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX \`idx_cuota_cliente\` (\`client_id\`),
  INDEX \`idx_cuota_due_date\` (\`due_date\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. TABLA DE LOGS DE AUDITORÍA MDM & COBRANZA
CREATE TABLE IF NOT EXISTS \`mdm_logs\` (
  \`id\` VARCHAR(60) NOT NULL PRIMARY KEY,
  \`client_id\` VARCHAR(50) NULL,
  \`client_name\` VARCHAR(150) NOT NULL,
  \`imei\` VARCHAR(50) NOT NULL,
  \`action\` ENUM('LOCK', 'UNLOCK', 'STATUS_CHECK', 'UNLOCK_CODE', 'REMOVE', 'SYNC_DEVICES') NOT NULL,
  \`trigger_type\` ENUM('AUTOMATIC_OVERDUE', 'AUTOMATIC_PAYMENT', 'MANUAL_OPERATOR', 'SYSTEM_SYNC') NOT NULL,
  \`details\` TEXT NOT NULL,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX \`idx_log_imei\` (\`imei\`),
  INDEX \`idx_log_action\` (\`action\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. DATOS SEMILLA (SEED DATA PARA INICIALIZAR EN HOSTINGER)
INSERT INTO \`clientes\` (\`id\`, \`full_name\`, \`phone\`, \`credit_amount\`, \`balance_due\`, \`days_overdue\`, \`status\`) VALUES
('CLI-001', 'Carlos Mendoza Rivera', '+52 55 4192 8831', 6500.00, 4800.00, 4, 'ATRASADO'),
('CLI-002', 'María Fernanda López', '+52 33 1928 3341', 8200.00, 3100.00, 0, 'AL_DIA'),
('CLI-003', 'Jorge Eduardo Gómez', '+52 81 2239 4410', 5000.00, 5000.00, 11, 'VENCIDO');

INSERT INTO \`dispositivos\` (\`id\`, \`client_id\`, \`inovaguard_id\`, \`imei\`, \`model\`, \`mdm_status\`, \`last_mdm_sync\`) VALUES
('DEV-001', 'CLI-001', 'DEV-IG-8831', '358921098412334', 'Samsung Galaxy A54 5G', 'LOCKED', 'Lock automático por 4 días de mora en MySQL Hostinger'),
('DEV-002', 'CLI-002', 'DEV-IG-3341', '864192048192831', 'Xiaomi Redmi Note 13', 'UNLOCKED', 'Conectado - Estado al día'),
('DEV-003', 'CLI-003', 'DEV-IG-4410', '359012849102938', 'Motorola Moto G84', 'LOCKED', 'Bloqueo por mora crítica');

INSERT INTO \`cuotas\` (\`id\`, \`client_id\`, \`number\`, \`due_date\`, \`amount\`, \`late_fee\`, \`status\`, \`paid_at\`) VALUES
('CLI-001-c1', 'CLI-001', 1, '2025-01-01', 1200.00, 0.00, 'PAID', '2025-01-01 14:30:00'),
('CLI-001-c2', 'CLI-001', 2, '2025-01-15', 1200.00, 200.00, 'OVERDUE', NULL),
('CLI-001-c3', 'CLI-001', 3, '2025-02-01', 1200.00, 0.00, 'PENDING', NULL);
`;

export const HostingerSqlModal: React.FC<HostingerSqlModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'SQL' | 'NODE_API'>('SQL');

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(SQL_SCHEMA_TEXT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">
                Esquema MySQL DDL & API Node.js para Hostinger
              </h2>
              <p className="text-xs text-slate-400">
                Para reemplazar los datos iniciales por tu base de datos y servidor de cobranza en Hostinger
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pestañas SQL / API */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-2 space-x-2">
          <button
            onClick={() => setActiveTab('SQL')}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 border-b-2 ${
              activeTab === 'SQL'
                ? 'bg-white text-indigo-700 border-indigo-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>1. Esquema SQL (DDL) phpMyAdmin</span>
          </button>

          <button
            onClick={() => setActiveTab('NODE_API')}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 border-b-2 ${
              activeTab === 'NODE_API'
                ? 'bg-white text-indigo-700 border-indigo-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>2. Servicio API Node.js / Express</span>
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'SQL' ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 text-xs text-indigo-900">
                <div className="flex items-start space-x-2">
                  <Shield className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Instrucciones para Hostinger hPanel:</span>
                    Abre <strong>phpMyAdmin</strong> en tu Hosting/VPS, crea tu base de datos MySQL y pega el siguiente script para generar las tablas y datos iniciales en 1 clic.
                  </div>
                </div>

                <button
                  onClick={handleCopy}
                  className="inline-flex items-center space-x-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg shadow-xs transition-colors whitespace-nowrap self-start sm:self-center"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>¡Copiado al Portapapeles!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar Código SQL</span>
                    </>
                  )}
                </button>
              </div>

              <div className="relative">
                <pre className="bg-slate-900 text-slate-200 p-4 rounded-xl text-[11px] font-mono overflow-x-auto leading-relaxed border border-slate-800 max-h-[380px]">
                  {SQL_SCHEMA_TEXT}
                </pre>
              </div>
            </>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="bg-slate-900 text-white p-4 rounded-xl space-y-2 border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400 uppercase tracking-wider">
                    Servicio Node.js / Express generado en este proyecto
                  </span>
                  <span className="font-mono text-slate-400">/backend-example/server.js</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Hemos generado una aplicación de servidor en la carpeta <code>/backend-example</code> que usa <code>mysql2/promise</code> y publica los endpoints REST para reemplazar los datos estáticos del frontend.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-900 block mb-1">Endpoints de Datos (GET/POST)</span>
                  <ul className="space-y-1.5 text-slate-700">
                    <li><strong className="text-indigo-700">GET /api/clients</strong> → Devuelve todos los clientes, dispositivos y cuotas en el formato que requiere este frontend.</li>
                    <li><strong className="text-emerald-700">POST /api/clients</strong> → Inserta un nuevo crédito y su dispositivo en las tablas MySQL.</li>
                    <li><strong className="text-emerald-700">PUT /api/clients/:id/installments/:id/pay</strong> → Registra pago en vivo y actualiza saldos.</li>
                  </ul>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-900 block mb-1">Endpoints de MDM & Auditoría</span>
                  <ul className="space-y-1.5 text-slate-700">
                    <li><strong className="text-amber-700">PUT /api/devices/:imei/mdm-status</strong> → Cambia estado (LOCKED / UNLOCKED / PIN).</li>
                    <li><strong className="text-indigo-700">GET /api/logs</strong> → Consulta traza de órdenes MDM de Hostinger.</li>
                    <li><strong className="text-emerald-700">POST /api/logs</strong> → Registra eventos de bloqueo y mora en MySQL.</li>
                  </ul>
                </div>
              </div>

              <div className="bg-amber-50/70 border border-amber-300 rounded-xl p-4 text-amber-900">
                <span className="font-bold block mb-1">🚀 ¿Cómo conectar la app React con Hostinger?</span>
                <p>
                  1. Sube <code>/backend-example</code> a tu cuenta de Hostinger (cPanel Selector Node.js o VPS Ubuntu).<br />
                  2. Configura las credenciales en tu archivo <code>.env</code> con <code>DB_HOST=srvXXX.hstgr.io</code>.<br />
                  3. En tu frontend, cambia la URL base de tu API o importa las funciones en <code>/src/services/inovaGuardApi.ts</code> para consultar tu dominio de Hostinger.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Archivos creados en <code>/sql/schema_mysql_hostinger.sql</code> y <code>/backend-example/server.js</code>
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl"
          >
            Cerrar Ventana
          </button>
        </div>
      </div>
    </div>
  );
};
