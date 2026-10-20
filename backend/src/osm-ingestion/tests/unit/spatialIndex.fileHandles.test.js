// Proves that every fs.promises.open handle opened by spatialIndex is closed exactly once,
// including when a read or a setup step throws. Unclosed FileHandles crash Node during GC.
const fs = require('fs');
const { loadIndex, fetchFeaturesByIds } = require('../../src/spatialIndex');

function makeHandle(readImpl) {
  return {
    close: jest.fn().mockResolvedValue(undefined),
    read: jest.fn(readImpl || (async () => ({ bytesRead: 0 }))),
  };
}

describe('spatialIndex file handle cleanup', () => {
  const indexPath = '/tmp/fake/ways-rtree.idx';
  const dataPath = '/tmp/fake/uk-roads.jsonl';
  const offsetsPath = '/tmp/fake/ways-offsets.bin';

  test('loadIndex closes both opened handles when a stat step throws', async () => {
    const offsetsHandle = makeHandle();
    const dataHandle = makeHandle();
    jest
      .spyOn(fs.promises, 'open')
      .mockResolvedValueOnce(offsetsHandle)
      .mockResolvedValueOnce(dataHandle);
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.alloc(8));
    jest.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (p === dataPath) throw new Error('stat failed');
      return { size: 16 };
    });

    await expect(loadIndex(indexPath, dataPath, offsetsPath)).rejects.toThrow('stat failed');

    expect(offsetsHandle.close).toHaveBeenCalledTimes(1);
    expect(dataHandle.close).toHaveBeenCalledTimes(1);
  });

  test('loadIndex closes both opened handles when the index buffer cannot be parsed', async () => {
    const offsetsHandle = makeHandle();
    const dataHandle = makeHandle();
    jest
      .spyOn(fs.promises, 'open')
      .mockResolvedValueOnce(offsetsHandle)
      .mockResolvedValueOnce(dataHandle);
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('not a flatbush index at all'));
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 16 });

    await expect(loadIndex(indexPath, dataPath, offsetsPath)).rejects.toThrow();

    expect(offsetsHandle.close).toHaveBeenCalledTimes(1);
    expect(dataHandle.close).toHaveBeenCalledTimes(1);
  });

  test('fetchFeaturesByIds closes both handles it opened when a read throws mid-way', async () => {
    const offsetsHandle = makeHandle(async (buf) => {
      buf.writeBigUInt64LE(0n, 0);
      return { bytesRead: 8 };
    });
    const dataHandle = makeHandle(async () => {
      throw new Error('EIO mid-read');
    });
    jest
      .spyOn(fs.promises, 'open')
      .mockResolvedValueOnce(offsetsHandle)
      .mockResolvedValueOnce(dataHandle);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 16 });

    await expect(
      fetchFeaturesByIds(dataPath, [0], { dataPath, offsetsPath, offsetCount: null })
    ).rejects.toThrow('EIO mid-read');

    expect(offsetsHandle.close).toHaveBeenCalledTimes(1);
    expect(dataHandle.close).toHaveBeenCalledTimes(1);
  });
});
