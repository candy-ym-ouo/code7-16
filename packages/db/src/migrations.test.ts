import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/0001_init.sql"),
  "utf8"
);

const accessibilityMigration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/0003_accessibility_graph.sql"),
  "utf8"
);

describe("initial migration", () => {
  it("contains the core audited entities", () => {
    for (const table of [
      "users", "sessions", "auth_tokens", "categories", "map_features",
      "feature_revisions", "media_assets", "comments", "reports",
      "moderation_actions", "outbox_events", "audit_logs", "notifications"
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
  });

  it("adds public thumbnail and outbox recovery fields in migration 0002", () => {
    const followup = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../migrations/0002_media_public_thumb.sql"),
      "utf8"
    );
    expect(followup).toContain("public_thumbnail_object_key");
    expect(followup).toContain("updated_at timestamptz");
  });

  it("uses PostGIS geography points and spatial indexes", () => {
    expect(migration).toContain("geography(Point, 4326)");
    expect(migration).toContain("USING gist (geom)");
  });

  it("models accessible nodes, edges and a transactional graph version", () => {
    expect(accessibilityMigration).toContain("CREATE TABLE accessibility_nodes");
    expect(accessibilityMigration).toContain("CREATE TABLE accessibility_edges");
    expect(accessibilityMigration).toContain("geography(LineString, 4326)");
    expect(accessibilityMigration).toContain("CREATE TABLE accessibility_graph_meta");
    expect(accessibilityMigration).toContain("accessibility_touch_graph_version");
    expect(accessibilityMigration).toContain("slope_percent");
    expect(accessibilityMigration).toContain("clear_width_mm");
    expect(accessibilityMigration).toContain("max_step_height_mm");
  });
});
