import { HERALD_DB_SCHEMA, renderPrismaSchema } from "../../internal/db-schema/index.js";

export const PRISMA_SCHEMA = renderPrismaSchema(HERALD_DB_SCHEMA);
