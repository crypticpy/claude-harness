# R Project Initialization Plan

## Overview
Initialize an R project repository for voice-driven data analysis demonstrations on macOS M3 Pro.

## Current Environment Status
- **R Version**: 4.5.1 (ARM64/aarch64-apple-darwin20)
- **Homebrew**: Installed at `/opt/homebrew/bin/brew`
- **RStudio**: Installed (optional use)
- **renv**: Not installed (will install for dependency management)
- **Working Directory**: `/Users/aiml/Projects/Rdata` (empty)

---

## Implementation Steps

### Phase 1: Create Project Structure

Create the following directory structure:
```
/Users/aiml/Projects/Rdata/
├── data/
│   ├── raw/           # Original datasets
│   └── processed/     # Cleaned/transformed data
├── scripts/           # R analysis scripts
├── output/            # Generated charts, models
├── reports/           # Final HTML/Markdown reports
├── R/                 # Reusable R functions (optional)
└── tests/             # Unit tests (optional)
```

**Files to create:**
- `README.md` - Project documentation
- `.gitignore` - R-specific ignores
- `Rdata.Rproj` - RStudio project file
- `DESCRIPTION` - Package metadata (for renv compatibility)

### Phase 2: Initialize renv for Dependency Management

1. Install renv package:
   ```r
   install.packages("renv")
   ```

2. Initialize renv in project:
   ```r
   renv::init()
   ```

This creates:
- `renv/` directory (package cache)
- `renv.lock` (lockfile for reproducibility)
- `.Rprofile` (auto-activates renv)

### Phase 3: Install Core Packages

**Data Manipulation:**
- `tidyverse` (includes dplyr, ggplot2, tidyr, readr, purrr, stringr)

**Interactive Visualizations:**
- `plotly` - Interactive charts
- `htmlwidgets` - HTML widget framework

**Web Apps/Dashboards:**
- `shiny` - Interactive web applications
- `flexdashboard` - Easy dashboards via R Markdown

**Reporting:**
- `rmarkdown` - R Markdown documents
- `knitr` - Dynamic report generation
- `quarto` (CLI tool, install via Homebrew)

**Additional:**
- `DT` - Interactive data tables
- `leaflet` - Interactive maps

**Installation command:**
```r
renv::install(c(
  "tidyverse", "plotly", "htmlwidgets",
  "shiny", "flexdashboard",
  "rmarkdown", "knitr",
  "DT", "leaflet"
))
renv::snapshot()
```

### Phase 4: Create Template Files

1. **`scripts/analysis_template.R`**
   - Boilerplate for data loading/processing
   - Standard library imports
   - Data validation patterns

2. **`reports/visualization_template.Rmd`**
   - R Markdown template for HTML reports
   - YAML header configuration
   - Plotly chart examples

3. **`app.R`** (root directory)
   - Basic Shiny app skeleton
   - UI and server components
   - Ready-to-run demo

4. **`scripts/01_load_data.R`**
   - Example data loading script
   - CSV/Excel import patterns

### Phase 5: Configure Git

1. Initialize git repository
2. Create comprehensive `.gitignore`:
   - R-specific files (`.Rhistory`, `.RData`)
   - renv library cache
   - Output files (optional)
   - OS files (`.DS_Store`)

3. Create initial commit with project structure

### Phase 6: Documentation

Update `README.md` with:
- Project purpose
- Prerequisites (R installation for macOS ARM)
- Quick start guide
- Package installation instructions
- How to run scripts, reports, and Shiny apps
- Voice-driven workflow tips

---

## User Preferences
- **Git**: Initialize repository with initial commit
- **Sample Data**: Include sample datasets (iris, mtcars)
- **Report Format**: Both R Markdown (.Rmd) and Quarto (.qmd) templates

---

## Files to Create

| File | Purpose |
|------|---------|
| `README.md` | Project documentation |
| `.gitignore` | Git ignore rules |
| `Rdata.Rproj` | RStudio project config |
| `DESCRIPTION` | Package metadata |
| `.Rprofile` | renv auto-activation (created by renv::init) |
| `scripts/analysis_template.R` | Analysis boilerplate |
| `scripts/01_load_data.R` | Data loading example |
| `reports/visualization_template.Rmd` | R Markdown report template |
| `reports/visualization_template.qmd` | Quarto report template |
| `app.R` | Shiny app skeleton |
| `data/raw/iris.csv` | Sample dataset - iris flowers |
| `data/raw/mtcars.csv` | Sample dataset - motor cars |

---

## Execution Order

1. Create directory structure (`data/raw`, `data/processed`, `scripts`, `output`, `reports`)
2. Create `.gitignore` (R-specific + renv + OS files)
3. Create `README.md` with initial documentation
4. Create `Rdata.Rproj` (RStudio project file)
5. Create `DESCRIPTION` file (package metadata)
6. Initialize git repository (`git init`)
7. Install renv package (`R -e 'install.packages("renv")'`)
8. Initialize renv in project (`R -e 'renv::init()'`)
9. Install Quarto CLI via Homebrew (`brew install quarto`)
10. Install R packages via renv:
    - tidyverse, plotly, htmlwidgets
    - shiny, flexdashboard
    - rmarkdown, knitr
    - DT, leaflet
11. Create sample datasets (`data/raw/iris.csv`, `data/raw/mtcars.csv`)
12. Create template files:
    - `scripts/analysis_template.R`
    - `scripts/01_load_data.R`
    - `reports/visualization_template.Rmd`
    - `reports/visualization_template.qmd`
    - `app.R`
13. Snapshot dependencies (`R -e 'renv::snapshot()'`)
14. Create initial git commit

---

## Notes for Voice-Driven Workflow

- All scripts designed to run from terminal: `Rscript scripts/01_load_data.R`
- Reports render via CLI: `R -e "rmarkdown::render('reports/visualization_template.Rmd')"`
- Shiny apps launch from terminal: `R -e "shiny::runApp('app.R')"`
- Minimal IDE dependency for Claude-assisted development
