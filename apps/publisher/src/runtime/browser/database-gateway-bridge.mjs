// 浏览器 runtime 只能通过 DataBase Gateway 访问账号、cookie 和发布绑定。
// 这里是 .mjs 脚本的唯一 DataBase bridge，禁止在脚本里直连 MySQL 或散落 Gateway 路径。
export function createRuntimeDatabaseClient() {
  const baseUrl = (process.env.DATABASE_GATEWAY_URL || process.env.FANQIE_DATABASE_GATEWAY_URL || 'https://database.example.invalid').replace(/\/+$/, '');
  const apiKey = process.env.DATABASE_GATEWAY_API_KEY || process.env.FANQIE_DATABASE_GATEWAY_API_KEY;
  return {
    publication: {
      accounts: (input = {}) => get(baseUrl, apiKey, '/content/publication/accounts', input),
      recordFanqieAccountSession: (input, options = {}) => post(baseUrl, apiKey, '/writes/publication/record-fanqie-account-session', input, options.idempotencyKey),
    },
  };
}

async function get(baseUrl, apiKey, path, query) {
  return request(baseUrl, apiKey, 'GET', `${path}${toQuery(query)}`);
}

async function post(baseUrl, apiKey, path, body, idempotencyKey) {
  return request(baseUrl, apiKey, 'POST', path, { payload: body }, idempotencyKey);
}

async function request(baseUrl, apiKey, method, path, body, idempotencyKey) {
  const headers = {
    Accept: 'application/json',
    'X-Actor': 'fanqie-service-browser-runtime',
  };
  if (apiKey) headers['X-DataBase-Api-Key'] = apiKey;
  if (idempotencyKey) headers['X-DataBase-Idempotency-Key'] = idempotencyKey;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`DataBase Gateway returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return payload;
}

function toQuery(input) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
