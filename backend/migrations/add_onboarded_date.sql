-- Add onboarded_date column to merchant_information
-- This date is sourced from the WebXPay API (data.onboarded_date or similar)
-- and is used by the daily auto-run job to identify newly onboarded merchants.
ALTER TABLE merchant_information
  ADD COLUMN onboarded_date DATE NULL DEFAULT NULL AFTER merchant_channel;
