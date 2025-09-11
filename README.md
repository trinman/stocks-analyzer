AI Trading Strategy Analyzer 📈
https://img.shields.io/badge/License-MIT-yellow.svg https://img.shields.io/badge/React-18.0+-61DAFB?logo=react https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript

An advanced, browser-based tool for backtesting, optimizing, and refining trading strategies using comprehensive technical analysis and AI-powered insights from Google's Gemini API.

https://storage.googleapis.com/genai-assets/readme/stock-analyzer-demo.gif

✨ Key Features
🔍 Dynamic Market Analysis
Load up to 5 years of historical daily data for any stock symbol

Interactive TradingView charts for visualizing price action

Support for multiple symbols and timeframes

⚙️ Comprehensive Strategy Configuration
Technical Indicators: Bollinger Bands, RSI, MACD, and SMA trend filtering

Risk Management: Define risk-per-trade, ATR-based stop losses, and take-profit levels

Realistic Execution: Account for commission and slippage

📊 In-Depth Backtesting & Analysis
Run simulations on daily, weekly, or monthly timeframes

Analyze 15+ key performance metrics (Sharpe Ratio, CAGR, Alpha, Max Drawdown, Win Rate)

Detailed trade log and performance summary

🤖 AI-Powered Insights with Gemini
Generate expert analysis of your backtest results

Receive actionable suggestions for improving strategy performance

Integrated chat for follow-up questions and deeper analysis

📈 Advanced Parameter Optimization
1D or 2D optimizations to discover profitable parameter combinations

Intuitive heatmap visualization of optimization space

Identify robust strategy settings easily

💾 Data Export
Download complete trade log as CSV

Export high-level performance summary for further analysis

🚀 Quick Start
Prerequisites
Node.js 16+ and npm

Google Gemini API key (Get one here)

Installation
Clone the repository

bash
git clone https://github.com/your-username/ai-trading-strategy-analyzer.git
cd ai-trading-strategy-analyzer
Install dependencies

bash
npm install
Set up your Gemini API key

macOS/Linux:

bash
API_KEY="YOUR_GEMINI_API_KEY" npm run dev
Windows (PowerShell):

bash
$env:API_KEY="YOUR_GEMINI_API_KEY"; npm run dev
Windows (Command Prompt):

bash
set API_KEY="YOUR_GEMINI_API_KEY" && npm run dev
Open your browser
Navigate to http://localhost:5173 to use the application.

Note on Financial Data: This app uses the Financial Modeling Prep API with a free key. For heavy usage or production, consider getting your own key from FMP and updating FMP_API_KEY in src/services/apiServices.ts.

🛠️ Technology Stack
Frontend Framework: React 18 + TypeScript

Styling: Tailwind CSS

AI Integration: Google Gemini API (@google/genai)

Data Visualization: Recharts & TradingView Widgets

Financial Data: Financial Modeling Prep API

Build Tool: Vite

📖 Documentation
Strategy Development Guide

API Reference

Backtesting Tutorial

🤝 Contributing
We welcome contributions! Please read our Contributing Guidelines for details on how to submit pull requests, report bugs, or suggest new features.

📜 License
This project is licensed under the MIT License - see the LICENSE file for details.

👨🏾‍💻 Author
John Estrada - GitHub Profile

Version: 1.0

🔗 Related Projects
Lumibot - Trading framework for live execution

Backtesting.py - Backtesting framework inspiration

⚠️ Disclaimer
This tool is for educational and research purposes only. Past performance is not indicative of future results. Trading financial instruments involves risk and may not be suitable for all investors.

