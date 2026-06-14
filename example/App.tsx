import { BetweenUsApp } from './src/between-us/BetweenUsApp';

// Set to false to run the original Device Agent demo instead
const USE_BETWEEN_US = true;

export default function App() {
  if (USE_BETWEEN_US) {
    return <BetweenUsApp />;
  }

  // Loaded via require so Metro doesn't bundle llama.rn unless needed
  const { DeviceAgentApp } = require('./src/DeviceAgentApp');
  return <DeviceAgentApp />;
}
