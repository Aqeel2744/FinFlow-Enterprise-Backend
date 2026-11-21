
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const API_PATH = __ENV.API_PATH || '/api/v1/organizations';
const TOKEN = __ENV.TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjODZkZTVlZS1hNGVlLTQ1MGQtYTRlMy02MzJhZjk0NDQyYzIiLCJlbWFpbCI6InNhcmFoLmNmb0BhY21lLmNvbSIsImlhdCI6MTc5NTI1NzYzOCwiZXhwIjoxNzk1MjU4NTM4fQ.dXv9Z9UieOcEVvI_Jxj-qAdC1qszg4ErMZ65duAPL_E';

export default function () {
  const headers = TOKEN
    ? { Authorization: `Bearer ${TOKEN}` }
    : {};

  const response = http.get(`${BASE_URL}${API_PATH}`, {
    headers,
    tags: { endpoint: 'organizations' },
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response has data': (r) => {
      try {
        return JSON.parse(r.body).success === true;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
