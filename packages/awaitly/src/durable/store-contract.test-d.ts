/**
 * The store contract at the durable.run seam.
 *
 * The shipped adapters (awaitly-mongo, awaitly-postgres, awaitly-libsql)
 * implement the broad contract: save() accepts a snapshot or a ResumeState and
 * load() returns either. durable.run must accept those stores, or every
 * consumer needs a cast to pass in the adapter built for it.
 */

import { expectAssignable } from "tsd";
import { durable } from "./index";
import type {
  StoreLoadResult,
  StoreSaveInput,
} from "../workflow/store-contract";

/** The shape awaitly-mongo and friends actually implement. */
type AdapterStore = {
  save(id: string, state: StoreSaveInput): Promise<void>;
  load(id: string): Promise<StoreLoadResult>;
  delete(id: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
  }): Promise<Array<{ id: string; updatedAt: string }>>;
  close(): Promise<void>;
};

declare const adapterStore: AdapterStore;

type DurableStoreOption = NonNullable<
  NonNullable<Parameters<typeof durable.run>[2]>["store"]
>;

expectAssignable<DurableStoreOption>(adapterStore);
