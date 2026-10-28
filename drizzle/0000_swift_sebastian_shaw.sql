CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`tokens` integer NOT NULL,
	`cost` real,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collector_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sourceId` integer,
	`parentId` integer,
	`status` text NOT NULL,
	`startedAt` integer NOT NULL,
	`finishedAt` integer,
	`itemCount` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`sourceId`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interest_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`interests` text NOT NULL,
	`excluded` text NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processed_items` (
	`rawId` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`tone` text NOT NULL,
	`language` text NOT NULL,
	`type` text NOT NULL,
	`score` integer NOT NULL,
	`reason` text NOT NULL,
	`summary` text NOT NULL,
	`isSpam` integer NOT NULL,
	`model` text NOT NULL,
	`processedAt` integer NOT NULL,
	FOREIGN KEY (`rawId`) REFERENCES `raw_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `raw_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` integer NOT NULL,
	`platform` text NOT NULL,
	`externalId` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`author` text NOT NULL,
	`url` text NOT NULL,
	`thumbnail` text,
	`publishedAt` integer,
	`durationSeconds` integer,
	`fetchedAt` integer NOT NULL,
	FOREIGN KEY (`sourceId`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_items_url_unique` ON `raw_items` (`url`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channelId` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_channelId_unique` ON `sources` (`channelId`);