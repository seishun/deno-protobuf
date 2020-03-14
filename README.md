# Protobuf for deno

This repo contains a protobuf runtime usable from deno and a proof-of-concept
protoc plugin that generates appropriate code.

## Runtime

The runtime is taken from
https://github.com/protocolbuffers/protobuf/tree/master/js/experimental,
but `goog.module` and `goog.require` are replaced with ES6 modules and other
usage of the Closure Library is removed.

### TODO

* Make it a proper fork in a separate repo?
* Use BigInt to represent 64-bit integers?

## protoc plugin

The plugin is based on https://github.com/thesayyn/protoc-gen-ts.

### Installation

After cloning this repo, run `npm install -g` in the `gen` directory.

### Usage

`protoc -I=sourcedir --ts_out=dist myproto.proto`

### TODO

* Rewrite properly from scratch, perhaps using deno
