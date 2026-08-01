# Guía de Despliegue en Hostinger (Base de Datos MySQL + API Node.js)

Este directorio contiene el ejemplo completo para conectar la aplicación **CrediPay MDM** con una base de datos MySQL alojada en **Hostinger** y reemplazar las variables estáticas iniciales del frontend.

---

## 1. Crear la Base de Datos MySQL en Hostinger (hPanel)
1. Inicia sesión en tu cuenta de Hostinger e ingresa a tu plan de Hosting / VPS.
2. Ve a **Bases de Datos -> Bases de datos MySQL** y crea una nueva base de datos (por ejemplo, `uXXXXX_mdm_credipay`) junto con su usuario y contraseña.
3. Entra a **phpMyAdmin** desde Hostinger y ejecuta el archivo SQL incluido en este repositorio:
   - Archivo: `sql/schema_mysql_hostinger.sql`
   - Esto creará las tablas `clientes`, `dispositivos`, `cuotas`, `mdm_logs` y `mdm_configuracion`, e insertará los **datos semilla de ejemplo** automáticamente.

---

## 2. Configurar y Ejecutar la API REST (server.js)
1. Copia el archivo `.env.example` y renómbralo como `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edita `.env` con las credenciales exactas que te entregó Hostinger:
   ```env
   DB_HOST=srvXXX.hstgr.io # O localhost si la API corre en el mismo servidor Hostinger
   DB_PORT=3306
   DB_USER=uXXXXX_mdm_admin
   DB_PASSWORD=tu_contraseña_segura
   DB_NAME=uXXXXX_mdm_credipay
   ```
3. Instala las dependencias necesarias:
   ```bash
   npm install
   ```
4. Inicia el servidor Node.js/Express:
   ```bash
   npm start
   ```

---

## 3. Conexión desde el Frontend React
Una vez en línea tu servicio en Hostinger (por ejemplo en `https://api.tudominio.com` o en el puerto `3001` de tu VPS), puedes actualizar tu frontend para consultar este servidor:

- `GET /api/clients` → Devuelve la cartera de clientes, dispositivos InovaGuard y cuotas.
- `POST /api/clients` → Crea nuevos créditos en la base de datos de Hostinger.
- `PUT /api/clients/:id/installments/:id/pay` → Registra pagos en vivo en la BD MySQL.
- `PUT /api/devices/:imei/mdm-status` → Sincroniza estados de bloqueo (`LOCKED` / `UNLOCKED`).
- `GET /api/logs` y `POST /api/logs` → Auditoría inmutable en tabla `mdm_logs`.
