// ============================================================================
// CrediPay MDM - Fase 7
// openapi.ts — Especificación OpenAPI 3.1 de la API pública.
// Sirve: GET /api/v1/openapi.json y una página HTML en /api/v1/docs.
// ============================================================================

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'CrediPay MDM API',
    version: '1.0.0',
    description:
      'API del sistema de créditos para celulares con bloqueo MDM. Autenticación por sesión ' +
      '(cookie sid + CSRF) o por API key (X-API-Key) para integraciones externas.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ sessionAuth: [] }, { apiKeyAuth: [] }],
  components: {
    securitySchemes: {
      sessionAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'sid',
        description: 'Cookie de sesión httpOnly establecida en el login.',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key `cpk_...` generada desde el panel (permiso api_keys.manage).',
      },
    },
    schemas: {
      Client: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          full_name: { type: 'string' },
          phone: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'DELINQUENT'] },
        },
      },
      CollectionSummary: {
        type: 'object',
        description: 'Resumen del motor de cobranza IA del tenant.',
        properties: {
          installments: {
            type: 'object',
            properties: {
              pendiente: { type: 'integer' },
              vencido: { type: 'integer' },
              atrasado: { type: 'integer' },
              pagado: { type: 'integer' },
            },
          },
          overdueAmount: { type: 'number' },
          clientsAtRisk: { type: 'integer' },
          reminders: { type: 'object', properties: { pending: { type: 'integer' }, sent: { type: 'integer' } } },
        },
      },
    },
  },
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Inicia sesión. Si el usuario tiene 2FA devuelve { twoFactorRequired, ticket }.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  remember: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Sesión creada (Set-Cookie sid/csrf) o reto 2FA' },
          '401': { description: 'Credenciales inválidas' },
        },
      },
    },
    '/auth/login/totp': {
      post: {
        tags: ['Auth'],
        summary: 'Completa el login cuando el 2FA está activo (código TOTP de 6 dígitos)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ticket', 'code'],
                properties: {
                  ticket: { type: 'string' },
                  code: { type: 'string', description: 'Código TOTP o de recuperación' },
                  remember: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Sesión creada' }, '401': { description: 'Código inválido' } },
      },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Perfil y permisos de la sesión actual', responses: { '200': { description: 'OK' } } },
    },
    '/clients': {
      get: {
        tags: ['Cartera'],
        summary: 'Lista de clientes del tenant (sesión o API key)',
        responses: { '200': { description: 'Array de clientes', content: { 'application/json': {} } } },
      },
      post: {
        tags: ['Cartera'],
        summary: 'Crea un cliente (sujeto al límite del plan)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fullName'],
                properties: {
                  fullName: { type: 'string' },
                  phone: { type: 'string' },
                  cedulaOrId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Cliente creado' }, '403': { description: 'plan_limit_reached' } },
      },
    },
    '/collection/summary': {
      get: { tags: ['Cobranza IA'], summary: 'Resumen del motor de cobranza (permiso collection.view)', responses: { '200': { description: 'OK' } } },
    },
    '/collection/run': {
      post: {
        tags: ['Cobranza IA'],
        summary: 'Ejecuta el motor de cobranza automática (permiso collection.run)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { source: { type: 'string', enum: ['MANUAL', 'SCHEDULED', 'API'], default: 'MANUAL' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Corrida completada' } },
      },
    },
    '/saas/subscriptions/current': {
      get: { tags: ['SaaS'], summary: 'Suscripción y uso del tenant (permiso subscriptions.view)', responses: { '200': { description: 'OK' } } },
    },
    '/api-keys': {
      get: { tags: ['API Keys'], summary: 'Lista las API keys del usuario (permiso api_keys.manage)', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['API Keys'],
        summary: 'Crea una API key (la llave solo se muestra una vez)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 2, maxLength: 100 },
                  scopes: { type: 'array', items: { type: 'string' } },
                  expiresInDays: { type: 'integer', minimum: 1, maximum: 365 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Llave creada (data.key se muestra una sola vez)' } },
      },
    },
    '/api-keys/probe': {
      get: {
        security: [{ apiKeyAuth: [] }],
        tags: ['API Keys'],
        summary: 'Verifica autenticación por sesión o API key y devuelve identidad',
        responses: { '200': { description: 'Identidad del llamador' } },
      },
    },
  },
} as const;

export const docsHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CrediPay MDM · API Docs</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; }
    h1 { color: #34d399; font-size: 1.5rem; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: .85em; }
    .tag { display: inline-block; background: #334155; border-radius: 999px; padding: 2px 10px; font-size: .7em; margin-right: 6px; }
    .method { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: .6rem; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1e293b; font-size: .85rem; }
  </style>
</head>
<body>
  <h1>CrediPay MDM · Documentación de la API</h1>
  <p>Crear: OpenAPI 3.1 en <code>/api/v1/openapi.json</code>. Autenticación por sesión (cookie <code>sid</code>)
  o API key (<code>X-API-Key</code>).</p>
  <table id="paths"></table>
  <script>
    const table = document.getElementById('paths');
    fetch('/api/v1/openapi.json').then(r => r.json()).then(spec => {
      Object.entries(spec.paths).forEach(([p, ops]) => {
        Object.entries(ops).forEach(([m, op]) => {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td><span class="method" style="color:#34d399">'+m.toUpperCase()+'</span></td>' +
            '<td><code>'+p+'</code></td>' +
            '<td><span class="tag">'+(op.tags?.[0] ?? '')+'</span>'+op.summary+'</td>';
          table.appendChild(tr);
        });
      });
    });
  </script>
</body>
</html>`;