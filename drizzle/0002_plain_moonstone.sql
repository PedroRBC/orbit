ALTER TABLE `briefings` ADD `candidateCount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `briefings` ADD `budgetLimited` integer DEFAULT false NOT NULL;