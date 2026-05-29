-- Run this migration to remove the legacy document field and data tables.
-- These are replaced by Google AI (Gemini) document extraction.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS merchant_document_data;
DROP TABLE IF EXISTS merchant_document_fields;

SET FOREIGN_KEY_CHECKS = 1;
