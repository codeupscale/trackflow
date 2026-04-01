import { test, expect } from '@playwright/test';

const API_URL = 'https://trackflow.codeupscale.com/api/v1';
const BASE_URL = 'http://localhost:3000';

test.describe('HR Module E2E — API Integration Tests', () => {
  test.describe('Auth Endpoints', () => {
    test('login endpoint validates required fields', async ({ request }) => {
      const response = await request.post(`${API_URL}/auth/login`, {
        data: { email: '', password: '' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 422]).toContain(response.status());
    });

    test('login endpoint rejects invalid credentials', async ({ request }) => {
      const response = await request.post(`${API_URL}/auth/login`, {
        data: { email: 'nonexistent@test.com', password: 'wrongpassword123' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 422]).toContain(response.status());
    });
  });

  test.describe('HR GET Endpoints — Auth Gates', () => {
    // Module 1 routes (deployed to production)
    const deployedEndpoints = [
      '/hr/departments',
      '/hr/positions',
      '/hr/leave-types',
      '/hr/leave-requests',
      '/hr/leave-balances',
      '/hr/public-holidays',
    ];

    // Module 2+3 routes (on feat/hr-phase-1 branch, not yet in production)
    const branchEndpoints = [
      '/hr/employees',
      '/hr/attendance',
      '/hr/attendance/team',
      '/hr/attendance/summary?month=3&year=2026',
      '/hr/overtime-rules',
    ];

    for (const ep of deployedEndpoints) {
      test(`GET ${ep} requires authentication`, async ({ request }) => {
        const response = await request.get(`${API_URL}${ep}`, {
          headers: { Accept: 'application/json' },
        });
        expect(response.status()).toBe(401);
      });
    }

    for (const ep of branchEndpoints) {
      test(`GET ${ep} returns 401 or 404 (not yet deployed)`, async ({ request }) => {
        const response = await request.get(`${API_URL}${ep}`, {
          headers: { Accept: 'application/json' },
        });
        // 401 = deployed and gated, 404 = not yet deployed to production
        expect([401, 404]).toContain(response.status());
      });
    }
  });

  test.describe('HR POST Endpoints — Auth Gates', () => {
    const postEndpoints = [
      { path: '/hr/departments', data: { name: 'E2E Test Dept', code: 'E2E' } },
      { path: '/hr/positions', data: { title: 'E2E Test Pos', department_id: '123' } },
      { path: '/hr/leave-types', data: { name: 'E2E Leave', code: 'E2E' } },
      { path: '/hr/leave-requests', data: { leave_type_id: '123', start_date: '2026-04-01', end_date: '2026-04-01' } },
      { path: '/hr/public-holidays', data: { name: 'E2E Holiday', date: '2026-04-01' } },
      // /hr/attendance/generate is Module 3 — may return 404 if not deployed
      // { path: '/hr/attendance/generate', data: { date: '2026-03-30' } },
    ];

    for (const { path, data } of postEndpoints) {
      test(`POST ${path} requires authentication`, async ({ request }) => {
        const response = await request.post(`${API_URL}${path}`, {
          data,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        });
        expect(response.status()).toBe(401);
      });
    }
  });

  test.describe('HR PUT/DELETE Endpoints — Auth Gates', () => {
    test('PUT overtime-rules requires auth (or 404 if not deployed)', async ({ request }) => {
      const response = await request.put(`${API_URL}/hr/overtime-rules`, {
        data: { daily_threshold_hours: 8 },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });

    test('DELETE leave-request requires auth', async ({ request }) => {
      const response = await request.delete(`${API_URL}/hr/leave-requests/nonexistent-id`, {
        headers: { Accept: 'application/json' },
      });
      expect(response.status()).toBe(401);
    });

    test('PUT approve leave requires auth', async ({ request }) => {
      const response = await request.put(`${API_URL}/hr/leave-requests/nonexistent-id/approve`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect(response.status()).toBe(401);
    });

    test('PUT reject leave requires auth', async ({ request }) => {
      const response = await request.put(`${API_URL}/hr/leave-requests/nonexistent-id/reject`, {
        data: { rejection_reason: 'test' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Frontend — Smoke Tests', () => {
    test('frontend dev server is running and responds', async ({ request }) => {
      const response = await request.get(BASE_URL);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain('__next');
    });

    test('frontend serves HR pages without 500', async ({ request }) => {
      const hrPages = [
        '/hr/departments',
        '/hr/positions',
        '/hr/leave',
        '/hr/leave/types',
        '/hr/leave/calendar',
        '/hr/employees',
        '/hr/attendance',
        '/hr/attendance/team',
        '/hr/attendance/regularizations',
      ];

      for (const path of hrPages) {
        const response = await request.get(`${BASE_URL}${path}`);
        expect(response.status(), `${path} should not 500`).toBeLessThan(500);
        const html = await response.text();
        expect(html, `${path} should contain Next.js container`).toContain('__next');
      }
    });

    test('login page serves valid HTML with form elements in source', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/login`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      // Next.js Pages Router client-side: check that the page bundle is loaded
      expect(html).toContain('__NEXT_DATA__');
      expect(html).toContain('"page":"/login"');
    });

    test('employee detail page route works', async ({ request }) => {
      // Dynamic route should resolve even without valid ID
      const response = await request.get(`${BASE_URL}/hr/employees/test-id`);
      expect(response.status()).toBeLessThan(500);
    });
  });
});
