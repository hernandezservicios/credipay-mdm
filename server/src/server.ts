import { app } from './app.js';
import { env } from './config/env.js';

app.listen(env.APP_PORT, () => {
  console.log(`CrediPay MDM API escuchando en ${env.APP_URL} (puerto ${env.APP_PORT})`);
});
