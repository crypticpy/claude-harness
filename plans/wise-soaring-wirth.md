# Presentation Prep: R User Group Demo

## How the Presentation Was Built

### Technology Stack
- **Quarto** (`.qmd` file) - Not R Markdown, it's the newer Quarto format
- **Custom CSS** (`custom-theme.css`) - Hand-crafted dark theme with scroll animations
- **JavaScript** (`scroll-animations.js`, `slide-controller.js`) - Custom slide navigation
- **GitHub Pages** - Hosted at https://beyondearth.github.io/Rdata/

### How to Explain It
"The presentation itself was built with Quarto - it's a `.qmd` file that compiles to HTML. We wrote custom CSS for the dark theme and slide transitions. Even this presentation was voice-coded through Claude."

---

## Diabetes Dashboard - Talking Points

### What It Is
- ML dashboard analyzing CDC BRFSS 2015 data (253,680 survey responses)
- Two models: Logistic Regression and Random Forest (both AUC ~0.82)
- 8 integrated tabs for complete analysis

### Key Features to Demo
1. **Risk Predictor** - Input patient profile, get probability + confidence interval
2. **Causal Analysis** - DAG visualization, 42% of diabetes preventable via BP control
3. **Fairness Audit** - 20 disparity flags across demographics
4. **Discovery Lab** - "Resilient" individuals (15.4% have high risk but no diabetes)

### Likely Questions & Answers

**Q: How accurate is the model?**
A: "AUC of 0.82, which is solid for survey data. But remember - this is a demonstration, not for clinical use. Real medical models need clinical validation."

**Q: What does the 42% preventable mean?**
A: "That's the Population Attributable Fraction for high blood pressure. The causal analysis suggests if we could eliminate high BP in the population, we could prevent 42% of diabetes cases. It's the most impactful modifiable risk factor."

**Q: How does the fairness audit work?**
A: "We check if the model performs equally well across protected groups - age, sex, income, education. We found disparities, meaning the model predicts better for some groups than others. Important to know before deploying anything like this."

**Q: What R packages power this?**
A: "shiny and bslib for the UI, ranger for random forest, pROC for ROC curves, dagitty for causal diagrams, plotly for interactive charts."

---

## RespiWatch - Talking Points

### What It Is
- Multi-pathogen surveillance dashboard (H3N2, RSV, COVID-19, H5N1)
- Tracks 50+ countries with real API connections
- Real-time Rt estimation and Bayesian forecasting

### Key Features to Demo
1. **Global Map** - Animated timeline showing outbreak progression
2. **Rt Analysis** - EpiEstim-based reproduction number ("Is it growing?")
3. **Bayesian Forecast** - brms/Stan models with 50/80/95% credible intervals
4. **Scenario Analysis** - 8 "what-if" interventions (lockdown, masks, vaccines)
5. **Fallback System** - When CDC data is missing, pulls wastewater, ECDC, WHO

### Likely Questions & Answers

**Q: Where does the data come from?**
A: "10+ real APIs - CDC FluView, RSV-NET, WHO FluMart, ECDC, and wastewater surveillance through NWSS. The fallback system automatically switches sources when one is unavailable."

**Q: What is Rt and why does it matter?**
A: "Rt is the effective reproduction number - how many people each infected person spreads to. Above 1 means growing, below 1 means shrinking. We use EpiEstim, a standard epidemiological R package."

**Q: How does the Bayesian forecasting work?**
A: "brms package which interfaces with Stan. Hierarchical model with seasonal components. Gives us probability distributions, not point estimates - so we can show 50%, 80%, 95% confidence bands."

**Q: Is this production-ready?**
A: "No - it's a demonstration. The APIs are real, the math is real, but this hasn't been validated for public health decision-making. The About page has a disclaimer."

**Q: What's the fallback system?**
A: "We discovered CDC APIs can be incomplete or delayed. So we built a cascade: try CDC first, then WHO, then ECDC, then wastewater surveillance. Users see a banner showing which sources were used."

---

## General Q&A Prep

**Q: How long did this take?**
A: "About 30 hours total over a few days. The first ML pipeline took maybe an hour. Most time went into polishing the dashboards and building the fallback system."

**Q: What model of Claude did you use?**
A: "Claude Opus 4.5 via Claude Code. It's Anthropic's CLI tool that gives Claude access to read/write files, run terminal commands."

**Q: What's a 'skill' in Claude Code?**
A: "It's a way to inject domain knowledge. We wrote an R Data Science skill with patterns for tidyverse, ggplot2, Shiny architecture. It helps Claude write idiomatic R code."

**Q: Did you ever have to fix code manually?**
A: "Occasionally corrected things by voice - 'that's not quite right, try X instead.' But I never opened an IDE. Maybe 1-2% manual intervention."

**Q: What surprised you most?**
A: "How well it handled the epidemiological methods - EpiEstim, brms. Also discovering the surveillance data gaps and building the fallback system organically."

**Q: What's next?**
A: "This was a demonstration of the workflow. The tools are shareable - the R Data Science skill is in the repo. Anyone can use Claude Code + this skill."

---

## Demo Flow Suggestion

1. **Start with presentation** - GitHub Pages slides
2. **Show Diabetes Dashboard** - Risk Predictor tab (interactive), then Causal Analysis (the 42% finding)
3. **Show RespiWatch** - Global map with animation, then Rt Analysis, then mention the fallback system
4. **Questions** - Have the slides up for links

---

## Key Links for the Audience
- GitHub: https://github.com/crypticpy/Rdata
- Diabetes Dashboard: https://huggingface.co/spaces/BeyondEarth/diabetes-dashboard
- RespiWatch: https://huggingface.co/spaces/BeyondEarth/respiwatch
- Presentation: https://beyondearth.github.io/Rdata/
