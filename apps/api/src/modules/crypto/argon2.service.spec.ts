import { Argon2Service } from './argon2.service';

describe('Argon2Service', () => {
  const svc = new Argon2Service();

  it('verifies its own hash', async () => {
    const h = await svc.hash('correct horse battery staple');
    await expect(svc.verify(h, 'correct horse battery staple')).resolves.toBe(true);
    await expect(svc.verify(h, 'wrong')).resolves.toBe(false);
  });
});
