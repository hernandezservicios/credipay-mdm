import { app } from './app.js';
import { env } from './config/env.js';
import { startSchedulerIfEnabled } from './scheduler.js';

app.listen(env.APP_PORT, async () => {
  console.log(`CrediPay MDM API escuchando en ${env.APP_URL} (puerto ${env.APP_PORT})`);
  const schedulerOn = await startSchedulerIfEnabled().catch((err) => {
    console.error('[scheduler] no se pudo iniciar:', err);
    return false;
  });
  if (schedulerOn) {
    console.log('[scheduler] tareas automáticas habilitadas');
  } else {
    console.log('[scheduler] tareas automáticas deshabilitadas');
  }
});