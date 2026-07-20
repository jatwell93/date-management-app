// Chart.js setup isolated into its own module so it is only pulled in through the
// lazy() wrappers below — keeping chart.js out of the initial page bundle.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register the superset of scales/elements used across all report charts (bar + line).
// Registering unused pieces is harmless for pages that only render one chart type.
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

export { Bar, Line } from 'react-chartjs-2';
