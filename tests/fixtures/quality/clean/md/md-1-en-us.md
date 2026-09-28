# Getting started

This guide explains how to configure the build pipeline for a new project.
Each step lists the command to run and the output you should expect.

## Install dependencies

Run `npm ci` from the repository root. The command installs the exact
versions recorded in `package-lock.json`, so every machine builds the same
artifacts.

## Run the tests

The test suite runs offline and takes less than a minute on a typical laptop.
If a test fails, read its message first: most failures point directly at the
file and line that need attention.
