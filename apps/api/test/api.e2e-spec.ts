import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';

describe('novel-writer API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const testEmail = `e2e-test-${Date.now()}@test.local`;
  const testPassword = 'TestPass123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    const ds = app.get(DataSource);
    await ds.query(`DELETE FROM nw_users WHERE email = ?`, [testEmail]);
    await app.close();
  });

  describe('Health', () => {
    it('GET /api/v1/health → 200 with status ok', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  describe('Auth', () => {
    it('POST /api/v1/auth/register → 201 creates user and returns token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: testEmail, password: testPassword, fullName: 'E2E Tester' });
      expect(res.status).toBe(201);
      expect(res.body.access_token).toBeDefined();
      token = res.body.access_token;
    });

    it('POST /api/v1/auth/register → 401 duplicate email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: testEmail, password: testPassword });
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/auth/login → 201 with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword });
      expect(res.status).toBe(201);
      expect(res.body.access_token).toBeDefined();
      token = res.body.access_token;
    });

    it('POST /api/v1/auth/login → 401 with wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: 'wrong' });
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/auth/login → 401 with non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'noone@nowhere.test', password: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('Library (requires JWT)', () => {
    it('GET /api/v1/library/work-list → 401 without token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/library/work-list');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/library/work-list → 200 with token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/library/work-list')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    let createdWorkId: number;

    it('POST /api/v1/library/create-work → 201 creates a work', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/library/create-work')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'E2E Test Work', description: 'test', status: 'draft' });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toBeDefined();
      createdWorkId = res.body.data.id;
    });

    it('POST /api/v1/library/delete-work → 201 deletes a work', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/library/delete-work')
        .set('Authorization', `Bearer ${token}`)
        .send({ id: createdWorkId });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
    });
  });

  describe('Session (requires JWT)', () => {
    it('GET /api/v1/session/list → 401 without token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/session/list');
      expect(res.status).toBe(401);
    });

    let createdSessionId: number;

    it('POST /api/v1/session/create-session → 201 creates session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/session/create-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'E2E Session', model: 'gpt-4o' });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toBeDefined();
      createdSessionId = res.body.data.id;
    });

    it('GET /api/v1/session/list → 200 returns sessions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/session/list')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find((s: any) => s.id === createdSessionId);
      expect(found).toBeDefined();
    });
  });

  describe('Chat (requires JWT)', () => {
    it('POST /api/v1/chat/chat/v2 → 401 without token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/chat/v2')
        .send({ messages: [{ role: 'user', content: 'hi' }] });
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/chat/model-success-rates → 401 without token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/model-success-rates');
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/chat/model-success-rates → 201 with token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/model-success-rates')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
