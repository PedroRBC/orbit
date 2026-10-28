CREATE TABLE `briefings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot` text NOT NULL,
	`introduction` text NOT NULL,
	`createdAt` integer NOT NULL,
	`windowFrom` integer NOT NULL,
	`windowTo` integer NOT NULL,
	`model` text NOT NULL,
	`sourceCount` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefings_snapshot_unique` ON `briefings` (`snapshot`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`rawId` text PRIMARY KEY NOT NULL,
	`vote` integer DEFAULT 0 NOT NULL,
	`saved` integer DEFAULT false NOT NULL,
	`seen` integer DEFAULT false NOT NULL,
	`clicked` integer DEFAULT false NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`rawId`) REFERENCES `raw_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`briefingId` integer NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`itemIds` text NOT NULL,
	FOREIGN KEY (`briefingId`) REFERENCES `briefings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `interest_profile` ADD `weights` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `processed_items` ADD `clusterId` text REFERENCES topics(id);