CREATE TABLE `companion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` integer NOT NULL,
	`runId` integer NOT NULL,
	`owner` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`result` text,
	`errorCode` text,
	FOREIGN KEY (`sourceId`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runId`) REFERENCES `collector_runs`(`id`) ON UPDATE no action ON DELETE no action
);
