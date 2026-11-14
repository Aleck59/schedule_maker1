import { assertProductionSecrets, jwtSecretProblems } from './configuration';

const strong = (c: string) => c.repeat(40);

describe('jwtSecretProblems', () => {
  it('вне продакшена не проверяет', () => {
    expect(jwtSecretProblems({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('в продакшене требует заданные, не заглушечные, длинные и разные секреты', () => {
    expect(jwtSecretProblems({ NODE_ENV: 'production' })).toHaveLength(2);
    expect(
      jwtSecretProblems({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret',
        JWT_REFRESH_SECRET: 'dev-refresh-secret',
      }),
    ).toHaveLength(2);
    expect(
      jwtSecretProblems({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'short',
        JWT_REFRESH_SECRET: strong('b'),
      }),
    ).toHaveLength(1);
    expect(
      jwtSecretProblems({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strong('a'),
        JWT_REFRESH_SECRET: strong('a'),
      }),
    ).toEqual(['JWT_ACCESS_SECRET и JWT_REFRESH_SECRET совпадают']);
  });

  it('assertProductionSecrets падает с понятной ошибкой и пропускает хорошие секреты', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(/openssl rand -hex 32/);
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strong('a'),
        JWT_REFRESH_SECRET: strong('b'),
      }),
    ).not.toThrow();
  });
});
