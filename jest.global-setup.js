module.exports = async () => {
  const url = process.env.DATABASE_URL || '';
  if (!/(_test|test_|localhost|127\.0\.0\.1)/i.test(url)) {
    throw new Error(
      `Refusing to run tests against a database that doesn't look like a test database: ${url}`
    );
  }
};
