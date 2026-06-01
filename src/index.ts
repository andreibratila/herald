// ============================================================
// herald — src/index.ts
// Public API surface
// ============================================================

// Core
export { configureHerald } from "./core/configure.js";
export type { SendResult } from "./core/herald.js";
export type {
  ConfigureHeraldConfig,
  ConfiguredEventDefinition,
  ConfiguredEventRef,
  DefineEventForApp,
  HeraldApp,
} from "./core/configure.js";

// Compliance
export {
  evaluateCompliance,
  hashSubjectId,
  legalBases,
  resolveCompliancePolicy,
  validateCompliancePolicy,
  validateLegalBasisDefinitions,
} from "./compliance/index.js";
export type { LegalBasisRegistry } from "./compliance/index.js";

// Types
export type {
  // Config
  HeraldConfig,
  HeraldChannelsConfig,
  HeraldChannelsConfigInput,
  HeraldEmailChannelConfig,
  HeraldEmailChannelConfigInput,
  HeraldComplianceConfig,
  HeraldRetentionConfig,
  HeraldDatabaseAdapter,
  HeraldMailAdapter,
  HeraldMailAdapterInput,
  LazyHeraldAdapter,
  HeraldHooks,
  QueueConfig,
  QueueConfigSync,
  QueueConfigDb,
  QueueConfigAdapter,
  HeraldQueueAdapter,
  HeraldQueueCapabilities,
  HeraldQueueJob,
  HeraldQueueProcessor,
  SendOptions,
  // Compliance
  LegalBasisKey,
  ComplianceDecisionStatus,
  LegalBasisMinimumRequirements,
  LegalBasisDefinition,
  ChannelCompliancePolicy,
  EventCompliancePolicy,
  ResolvedCompliancePolicy,
  ConsentStatus,
  ConsentEvent,
  Suppression,
  ComplianceDecision,
  ComplianceCheckInput,
  ComplianceDatabaseAdapter,
  CreateConsentEventInput,
  CreateSuppressionInput,
  // Domain
  Notification,
  Delivery,
  DeliveryStatus,
  AuditLog,
  ComplianceExportData,
  Channel,
  Recipient,
  // Schema
  HeraldSchema,
  InferSchema,
  // Templates
  EmailTemplate,
  InAppTemplate,
  TemplateDefinition,
  EventDefinition,
  // Per-instance registry refs
  EventRef,
  StartScheduledWorkerOptions,
  // Mail
  SendEmailInput,
  SendEmailResult,
} from "./types/index.js";
