CREATE TABLE `editions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot` text NOT NULL,
	`localDate` text NOT NULL,
	`edition` text NOT NULL,
	`timezone` text NOT NULL,
	`scheduledAt` integer NOT NULL,
	`windowFrom` integer NOT NULL,
	`windowTo` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`generatedAt` integer,
	`content` text,
	`itemIds` text DEFAULT '[]' NOT NULL,
	`model` text,
	`notice` text,
	`sourceCount` integer DEFAULT 0 NOT NULL,
	`candidateCount` integer DEFAULT 0 NOT NULL,
	`budgetLimited` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `editions_slot_unique` ON `editions` (`slot`);--> statement-breakpoint
ALTER TABLE `collector_runs` ADD `kind` text DEFAULT 'collection' NOT NULL;--> statement-breakpoint
ALTER TABLE `collector_runs` ADD `editionId` integer REFERENCES editions(id);