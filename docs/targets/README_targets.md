# AI Training Target Database

This folder serves as the main, reference database of training targets designed for analysis by both humans and AI systems.  
All files are written in a simple Markdown format to ensure it can be easily read, copied, processed, and used across different environments without relying on visual data.

Each target in this database is **fully verifiable** and corresponds to a real, existing place or object.  
These are not paranormal or speculative targets — they are training targets based on data that can be confirmed using maps, search engines, and other publicly available sources.

## What Each Target Contains

Each entry in this database includes several core elements:

- **Target coordinates**  
  Coordinates are provided as a reference point.  
  It is recommended to use your own operational coordinates during sessions and treat the provided ones as a reference only.

- **Date of the target**  
  The time frame in which the target is set.  
  This may be a specific date, day, hour, month, or a broader time range depending on the context.

- **Target**  
  A short name or one-sentence description that identifies the subject of the target.

- **Target description**  
  A more detailed, text-based description of the location, object, or area, designed to be clear and useful for analysis.

## Design Principles

This database is intended as a training tool.  
Its purpose is to support both humans and AI models in evaluating, comparing, and analyzing targets.

All targets are described purely in text, without the use of images.  
This allows efficient use with AI systems, avoiding high token costs associated with processing visual data.

If deeper information is needed, each target can be independently verified using external sources such as maps, satellite imagery, or search engines.

## File Structure

This folder is the main reference folder.  
Additionally, a separate working file exists in the `Vault` folder in JSON format, specifically designed for AI interaction.

The JSON file allows the model to:
- mark targets as processed,
- store notes and observations,
- access structured data,
- operate without modifying the source file.

The main reference folder **should not be modified during active work**.  
Any annotations, edits, or processing should be done in the JSON file located in the `Vault` directory.  
This folder remains the stable reference source.

## Project Goal

The goal of this project is to build a clear, structured, and expandable database of training targets that can serve as a shared foundation for both human and AI workflows.


## Repository Structure

The detailed targets are stored  in the `dosc/targets/` folder, where each target has its own dedicated Markdown file.

Structure:

```text
dosc/
├── targets.md
├── targets/
│   ├── target_0001.md
│   ├── target_0002.md
│   ├── target_0003.md
│   ├── target_0004.md
│   ├── target_0005.md
│   ├── target_0006.md
│   ├── target_0007.md
│   ├── target_0008.md
│   ├── target_0009.md
│   ├── target_0010.md
│   ├── target_0011.md
│   ├── target_0012.md
│   ├── target_0013.md
│   ├── target_0014.md
│   ├── target_0015.md
│   ├── target_0016.md
│   ├── target_0017.md
│   ├── target_0018.md
│   ├── target_0019.md
│   └── target_0020.md
