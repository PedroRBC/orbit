CREATE TABLE `push_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscriptionId` text NOT NULL,
	`editionId` integer NOT NULL,
	`kind` text DEFAULT 'edition' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`createdAt` integer NOT NULL,
	`attemptedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_deliveries_edition` ON `push_deliveries` (`subscriptionId`,`editionId`) WHERE "push_deliveries"."kind" = 'edition';--> statement-breakpoint
CREATE INDEX `push_deliveries_status` ON `push_deliveries` (`status`,`id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);