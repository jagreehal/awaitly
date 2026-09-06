import { postgres } from '../packages/awaitly-postgres/dist/index.js';
import { mongo } from '../packages/awaitly-mongo/dist/index.js';
import { libsql } from '../packages/awaitly-libsql/dist/index.js';

export function createStore({ adapter, url, namespace }) {
  switch (adapter) {
    case 'postgres':
      return postgres({ url, table: namespace, lock: { lockTableName: `${namespace}_lock` } });
    case 'mongo':
      return mongo({ url, collection: namespace, lock: { lockCollectionName: `${namespace}_lock` },
        clientOptions: { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500 } });
    case 'libsql':
      return libsql({ url, table: namespace, lock: { lockTableName: `${namespace}_lock` } });
    default:
      throw new Error(`Unknown adapter: ${adapter}`);
  }
}
