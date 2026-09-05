-- MuscleOS Database Initialization
-- Creates extensions and initial setup

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable Row Level Security (RLS) for multi-tenant isolation
-- Note: RLS policies should be added after Prisma migration
