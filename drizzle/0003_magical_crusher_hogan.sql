CREATE TABLE `source_items` (
	`sourceId` integer NOT NULL,
	`rawId` text NOT NULL,
	PRIMARY KEY(`sourceId`, `rawId`),
	FOREIGN KEY (`sourceId`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rawId`) REFERENCES `raw_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `raw_items` ADD `evidence` text DEFAULT 'rss' NOT NULL;--> statement-breakpoint
ALTER TABLE `raw_items` ADD `metrics` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `kind` text DEFAULT 'youtube_rss' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `platform` text DEFAULT 'youtube' NOT NULL;
--> statement-breakpoint
INSERT INTO `source_items` (`sourceId`, `rawId`) SELECT `sourceId`, `id` FROM `raw_items`;