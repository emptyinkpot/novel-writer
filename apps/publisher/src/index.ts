import { createContainer } from './container.js';

const container = createContainer();

container.app.listen(container.config.port, container.config.host, () => {
  console.log(`[fanqie-service] listening on http://${container.config.host}:${container.config.port}`);
});

