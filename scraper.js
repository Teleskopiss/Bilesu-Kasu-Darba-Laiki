// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// Rīga station is excluded - schedule is complex but never changes
const RIGA_STATIC_SCHEDULE = {
  type: 'segments',
  weekday: ['04:35-23:50'],
  saturday: ['04:35-23:50'],
  sunday: ['04:35-23:50']
};

const STATIONS = {
  tukums: [
    { name: 'Torņakalns', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/tornakalns/' },
    { name: 'Zasulauks', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/zasulauks/' },
    { name: 'Zolitūde', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/zolitude/' },
    { name: 'Imanta', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/imanta/' },
    { name: 'Bulduri', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/bulduri/' },
    { name: 'Majori', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/majori/' },
    { name: 'Dubulti', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/dubulti/' },
    { name: 'Sloka', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/sloka/' },
    { name: 'Tukums I', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/tukums-i/' }
  ],
  jelgavas: [
    { name: 'Torņakalns', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/tornakalns/' },
    { name: 'Olaine', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/olaine/' },
    { name: 'Jelgava', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/jelgava/' }
  ],
  skulte: [
    { name: 'Zemitāni', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/zemitani/' }
  ],
  aizkraukles: [
    { name: 'Salaspils', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/salaspils/' },
    { name: 'Ogre', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/ogre/' },
    { name: 'Lielvārde', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/lielvarde/' },
    { name: 'Aizkraukle', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/aizkraukle/' }
  ]
};

async function scrapeStation(url) {
  try {
    console.log(`  Fetching: ${url}`);
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    const schedule = {
      type: 'segments',
      weekday: [],
      saturday: [],
      sunday: []
    };
    
    // Find the table with schedule data
    let weekdayTimes = [];
    let weekendTimes = [];
    
    // Look for table rows - ViVi uses a specific table structure
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const col1 = $(cells[0]).text().trim();
        const col2 = $(cells[1]).text().trim();
        
        // Check if this is a data row (contains time format like "7.20 - 9.35")
        if (col1.match(/\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/)) {
          weekdayTimes.push(col1);
          weekendTimes.push(col2);
        }
      }
    });
    
    // Convert times to standard format (HH:MM-HH:MM)
    schedule.weekday = weekdayTimes.map(normalizeTime).filter(t => t);
    schedule.saturday = weekendTimes.map(normalizeTime).filter(t => t);
    schedule.sunday = weekendTimes.map(normalizeTime).filter(t => t);
    
    console.log(`  Found ${schedule.weekday.length} weekday segments, ${schedule.saturday.length} weekend segments`);
    
    return schedule;
  } catch (error) {
    console.error(`  Error scraping ${url}:`, error.message);
    return null;
  }
}

function normalizeTime(timeStr) {
  if (!timeStr) return null;
  
  // Remove extra whitespace
  timeStr = timeStr.trim();
  
  // Check if it's closed
  if (timeStr.toLowerCase().includes('slēgts') || 
      timeStr.toLowerCase().includes('nedarbojas') ||
      timeStr === '-') {
    return null;
  }
  
  // Convert format like "7.20 - 9.35" to "07:20-09:35"
  const match = timeStr.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
  if (match) {
    const startHour = match[1].padStart(2, '0');
    const startMin = match[2];
    const endHour = match[3].padStart(2, '0');
    const endMin = match[4];
    return `${startHour}:${startMin}-${endHour}:${endMin}`;
  }
  
  return null;
}

async function scrapeAllStations() {
  const data = {
    lastUpdated: new Date().toISOString(),
    lines: {}
  };
  
  for (const [lineId, stations] of Object.entries(STATIONS)) {
    console.log(`\nScraping ${lineId} line...`);
    data.lines[lineId] = {
      name: lineId.charAt(0).toUpperCase() + lineId.slice(1) + ' līnija',
      stations: {
        // Add Rīga static schedule to every line
        'Rīga': RIGA_STATIC_SCHEDULE
      }
    };
    
    for (const station of stations) {
      console.log(`\n  Station: ${station.name}`);
      const schedule = await scrapeStation(station.url);
      if (schedule && (schedule.weekday.length > 0 || schedule.saturday.length > 0)) {
        data.lines[lineId].stations[station.name] = schedule;
      } else {
        console.log(`  Warning: No schedule data found for ${station.name}`);
        // Use empty schedule as fallback
        data.lines[lineId].stations[station.name] = {
          type: 'segments',
          weekday: [],
          saturday: [],
          sunday: []
        };
      }
      // Wait a bit to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  return data;
}

async function main() {
  console.log('Starting ViVi schedule scraper...');
  console.log('======================================\n');
  
  const data = await scrapeAllStations();
  
  fs.writeFileSync('schedules.json', JSON.stringify(data, null, 2));
  
  console.log('\n======================================');
  console.log('✓ Schedules saved to schedules.json');
  console.log(`✓ Last updated: ${data.lastUpdated}`);
  console.log('======================================');
}

main().catch(console.error);
