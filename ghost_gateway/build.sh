#!/bin/bash
set -e

echo "Building Ghost Gateway..."

# Build the Rust application
cargo build --release

echo "Build completed successfully!"
echo "Binary available at: target/release/ghost_gateway"
