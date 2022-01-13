#!/bin/bash
url=http://teku-archive.lan:5051


function fetch_state() {
  slot="$1"
  file="test-data/state-$slot.ssz"
  if [ -f "$file" ]; then
    echo "skipping state: $file already exists"
    return 0
  fi
  curl "$url/eth/v2/debug/beacon/states/$slot" \
    -H  "accept: application/octet-stream" \
    -o $file
}

function fetch_block() {
  slot="$1"
  i="$2"
  file="test-data/block-$((slot+i)).json"
  if [ -f "$file" ]; then
    echo "skipping block: $file already exists"
    return 0
  fi
  curl -X GET "$url/eth/v2/beacon/blocks/$((slot + i))" \
    -H  "accept: application/json" \
    -o $file
}

function fetch_range() {
  slot="$1"
  fetch_state $slot
  for i in {0..64}; do
    fetch_block $slot $i
  done
}

fetch_range 320     # fetch slots way before altair fork
fetch_range 2375680 # fetch from first altair slot
fetch_range 2375679 # fetch from last phase0 slot
fetch_range 2880000 # fetch slots way ahead altair fork