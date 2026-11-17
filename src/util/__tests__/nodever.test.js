test('runs on Node 18 from .nvmrc', () => { expect(process.version.startsWith('v18')).toBe(true); });
