CREATE TYPE accessibility_node_type AS ENUM (
  'entrance', 'building', 'room', 'platform', 'crossing', 'intersection', 'landmark', 'transit_stop'
);
CREATE TYPE accessibility_edge_type AS ENUM (
  'sidewalk', 'ramp', 'elevator', 'lift', 'stairs', 'threshold', 'path', 'crossing', 'door'
);
CREATE TYPE accessibility_surface AS ENUM (
  'paved', 'asphalt', 'concrete', 'rubber', 'brick', 'gravel', 'grass', 'dirt', 'tactile', 'metal', 'wood', 'unknown'
);
CREATE TYPE accessibility_operational_status AS ENUM ('operational', 'closed', 'maintenance', 'unknown');
CREATE TYPE accessibility_edge_direction AS ENUM ('forward', 'backward', 'both');

CREATE TABLE accessibility_graph_meta (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO accessibility_graph_meta(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE accessibility_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  description text,
  node_type accessibility_node_type NOT NULL,
  geom geography(Point, 4326) NOT NULL,
  floor text NOT NULL DEFAULT '1',
  indoor boolean NOT NULL DEFAULT false,
  operational_status accessibility_operational_status NOT NULL DEFAULT 'operational',
  threshold_step_mm integer NOT NULL DEFAULT 0,
  door_clear_width_mm integer,
  feature_id uuid REFERENCES map_features(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX accessibility_nodes_geom_gix ON accessibility_nodes USING gist (geom);
CREATE INDEX accessibility_nodes_feature_idx ON accessibility_nodes(feature_id) WHERE deleted_at IS NULL;

CREATE TABLE accessibility_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  from_node_id uuid NOT NULL REFERENCES accessibility_nodes(id) ON DELETE RESTRICT,
  to_node_id uuid NOT NULL REFERENCES accessibility_nodes(id) ON DELETE RESTRICT,
  edge_type accessibility_edge_type NOT NULL,
  direction accessibility_edge_direction NOT NULL DEFAULT 'both',
  name text,
  description text,
  geom geography(LineString, 4326) NOT NULL,
  length_m numeric(10, 2) NOT NULL,
  surface accessibility_surface NOT NULL DEFAULT 'unknown',
  slope_percent numeric(5, 2),
  clear_width_mm integer,
  max_step_height_mm integer NOT NULL DEFAULT 0,
  has_handrails boolean,
  door_clear_width_mm integer,
  operational_status accessibility_operational_status NOT NULL DEFAULT 'operational',
  source text NOT NULL DEFAULT 'curator',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (from_node_id <> to_node_id),
  CHECK (length_m >= 0 AND length_m <= 20000),
  CHECK (slope_percent IS NULL OR (slope_percent >= 0 AND slope_percent <= 100)),
  CHECK (clear_width_mm IS NULL OR clear_width_mm BETWEEN 100 AND 10000),
  CHECK (max_step_height_mm BETWEEN 0 AND 1000),
  CHECK (door_clear_width_mm IS NULL OR door_clear_width_mm BETWEEN 100 AND 5000)
);
CREATE INDEX accessibility_edges_from_idx ON accessibility_edges(from_node_id, deleted_at);
CREATE INDEX accessibility_edges_to_idx ON accessibility_edges(to_node_id, deleted_at);
CREATE INDEX accessibility_edges_type_idx ON accessibility_edges(edge_type, deleted_at);
CREATE UNIQUE INDEX accessibility_edges_pair_unique
  ON accessibility_edges(
    from_node_id,
    to_node_id,
    edge_type,
    COALESCE(name, ''),
    direction
  )
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION accessibility_touch_graph_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE accessibility_graph_meta
  SET version = version + 1,
      updated_at = now()
  WHERE id = 1;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER accessibility_nodes_graph_version_touch
  AFTER INSERT OR UPDATE OR DELETE ON accessibility_nodes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accessibility_touch_graph_version();

CREATE CONSTRAINT TRIGGER accessibility_edges_graph_version_touch
  AFTER INSERT OR UPDATE OR DELETE ON accessibility_edges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accessibility_touch_graph_version();
