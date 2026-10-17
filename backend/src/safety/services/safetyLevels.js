/**
 * Safety data levels shared by the route handler, the Overpass client and the graph builder.
 * "standard" = roads + lights only (faster, less data), "extra" = full dataset.
 *
 * Kept in its own module so consumers don't depend on overpassClient's exports.
 */
const SAFETY_LEVEL_STANDARD = "standard";
const SAFETY_LEVEL_EXTRA = "extra";

module.exports = {
  SAFETY_LEVEL_STANDARD,
  SAFETY_LEVEL_EXTRA,
};
