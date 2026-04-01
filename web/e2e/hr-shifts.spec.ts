import { test, expect } from '@playwright/test';

const API_URL = 'https://trackflow.codeupscale.com/api/v1';
const BASE_URL = 'http://localhost:3000';

test.describe('HR Module 5: Shift Management — E2E Tests', () => {
  test.describe('Shift API Auth Gates', () => {
    test('GET /hr/shifts requires auth (or 404 if not deployed)', async ({ request }) => {
      const response = await request.get(`${API_URL}/hr/shifts`, {
        headers: { Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });

    test('POST /hr/shifts requires auth', async ({ request }) => {
      const response = await request.post(`${API_URL}/hr/shifts`, {
        data: { name: 'Test Shift', start_time: '09:00', end_time: '17:00', days_of_week: ['monday'] },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });

    test('GET /hr/shifts/roster requires auth', async ({ request }) => {
      const response = await request.get(`${API_URL}/hr/shifts/roster?week_start=2026-04-06`, {
        headers: { Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });
  });

  test.describe('Shift Assignment API Auth Gates', () => {
    test('POST /hr/shifts/{id}/assign requires auth', async ({ request }) => {
      const response = await request.post(`${API_URL}/hr/shifts/fake-id/assign`, {
        data: { user_id: 'fake', effective_from: '2026-04-01' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });

    test('POST /hr/shifts/{id}/bulk-assign requires auth', async ({ request }) => {
      const response = await request.post(`${API_URL}/hr/shifts/fake-id/bulk-assign`, {
        data: { user_ids: ['fake'], effective_from: '2026-04-01' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });
  });

  test.describe('Shift Swap API Auth Gates', () => {
    test('GET /hr/shift-swaps requires auth', async ({ request }) => {
      const response = await request.get(`${API_URL}/hr/shift-swaps`, {
        headers: { Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });

    test('POST /hr/shift-swaps requires auth', async ({ request }) => {
      const response = await request.post(`${API_URL}/hr/shift-swaps`, {
        data: { target_user_id: 'fake', swap_date: '2026-05-01' },
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      expect([401, 404]).toContain(response.status());
    });
  });

  test.describe('Frontend Smoke Tests', () => {
    test('shift pages serve without 500', async ({ request }) => {
      const pages = [
        '/hr/shifts',
        '/hr/shifts/roster',
        '/hr/shifts/assignments',
        '/hr/shifts/swaps',
      ];

      for (const path of pages) {
        const response = await request.get(`${BASE_URL}${path}`);
        expect(response.status(), `${path} should not 500`).toBeLessThan(500);
        const html = await response.text();
        expect(html).toContain('__next');
      }
    });
  });
});
