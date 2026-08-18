// Run once at image-build time (as the `render` user) so every job's
// container starts with SuperDirt and the Dirt-Samples library already on
// disk instead of cloning them on first boot.
(
Quarks.install("SuperDirt");
0.exit;
)
