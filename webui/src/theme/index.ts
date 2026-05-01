// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import { createTheme } from '@mui/material/styles';
import '@fontsource/red-hat-mono/400.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/600.css';
import '@fontsource/jost/700.css';

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4fc3f7',
      light: '#8bf6ff',
      dark: '#0093c4',
    },
    secondary: {
      main: '#ffab00',
    },
    background: {
      default: '#606F77',
      paper: '#252525',
    },
    text: {
      primary: '#e0e0e0',
      secondary: '#a0a0a0',
    },
  },
  typography: {
    fontFamily: '"Jost",-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h6: {
      fontSize: '1.1rem',
      fontWeight: 500,
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiSlider: {
      styleOverrides: {
        root: {
          height: 4,
          '& .MuiSlider-thumb': {
            width: 16,
            height: 16,
            '&:hover': {
              boxShadow: '0px 0px 0px 8px rgba(79, 195, 247, 0.16)',
            },
          },
          '& .MuiSlider-rail': {
            opacity: 0.3,
          },
        },
      },
    },
  },
});