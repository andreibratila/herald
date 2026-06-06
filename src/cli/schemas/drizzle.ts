import { HERALD_DB_SCHEMA, renderDrizzleSchema } from "../../internal/db-schema/index.js";

export const DRIZZLE_SCHEMA = renderDrizzleSchema(HERALD_DB_SCHEMA);
