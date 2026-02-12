import { describe, expect, it } from "vitest";
import { Awaitly, ok, err, map, pipe } from "./index";

describe("root named exports", () => {
  it("keeps named exports aligned with Awaitly namespace", () => {
    expect(ok(1)).toEqual(Awaitly.ok(1));
    expect(err("E")).toEqual(Awaitly.err("E"));

    const mapped = map(ok(2), (n) => n + 1);
    const mappedViaNamespace = Awaitly.map(Awaitly.ok(2), (n) => n + 1);
    expect(mapped).toEqual(mappedViaNamespace);

    const piped = pipe(2, (n) => n * 2);
    const pipedViaNamespace = Awaitly.pipe(2, (n) => n * 2);
    expect(piped).toBe(pipedViaNamespace);
  });
});
