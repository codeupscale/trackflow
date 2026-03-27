const mockSharp = jest.fn((input) => {
  const instance = {
    metadata: jest.fn(() => Promise.resolve({ width: 1920, height: 1080 })),
    blur: jest.fn(() => instance),
    jpeg: jest.fn(() => instance),
    composite: jest.fn(() => instance),
    toBuffer: jest.fn(() => Promise.resolve(Buffer.from('mock-image-data'))),
  };
  return instance;
});

module.exports = mockSharp;
