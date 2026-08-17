import { expectType } from "tsd";
import { TaggedError, type SerializedTaggedError } from "./index";

class NotFoundError extends TaggedError("NotFoundError")<{ id: string }> {}

const wire = new NotFoundError({ id: "u1" }).toJSON();
expectType<SerializedTaggedError>(wire);
