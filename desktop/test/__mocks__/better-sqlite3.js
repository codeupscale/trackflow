// In-memory mock for better-sqlite3
class MockStatement {
  constructor(rows = []) {
    this._rows = rows;
    this._runResult = { changes: 0, lastInsertRowid: 1 };
  }
  run() { return this._runResult; }
  get() { return this._rows[0] || { count: 0 }; }
  all() { return this._rows; }
}

class MockDatabase {
  constructor() {
    this._tables = {};
    this._statements = {};
  }

  exec(sql) {
    // No-op for CREATE TABLE etc.
    return this;
  }

  pragma(value) {
    return value;
  }

  prepare(sql) {
    return new MockStatement(this._statements[sql] || []);
  }

  close() {}
}

module.exports = jest.fn(() => new MockDatabase());
