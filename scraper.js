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
    
    // Get all text content from the page
    const pageText = $('body').text();
    
    // METHOD 1: Try table format first (like Bulduri)
    let weekdayTimes = [];
    let weekendTimes = [];
    
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const col1 = $(cells[0]).text().trim();
        const col2 = $(cells[1]).text().trim();
        
        if (col1.match(/\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/)) {
          weekdayTimes.push(col1);
          weekendTimes.push(col2);
        }
      }
    });
    
    if (weekdayTimes.length > 0) {
      console.log(`  Format: Table (${weekdayTimes.length} segments)`);
      schedule.weekday = weekdayTimes.map(normalizeTime).filter(t => t);
      schedule.saturday = weekendTimes.map(normalizeTime).filter(t => t);
      schedule.sunday = weekendTimes.map(normalizeTime).filter(t => t);
      return schedule;
    }
    
    // METHOD 2: Check for semicolon-separated time segments (like Ogre)
    // Pattern: "4.55 - 6.10; 6.20 - 9.10; 9.30 - 11.10"
    const semicolonMatch = pageText.match(/(\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}\s*;\s*)+\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/);
    if (semicolonMatch) {
      console.log(`  Format: Semicolon-separated segments`);
      const segments = pageText.match(/\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/g);
      if (segments) {
        const normalizedSegments = segments.map(normalizeTime).filter(t => t);
        
        // Check if it's "katru dienu" (every day) or specific days
        if (pageText.match(/katru\s+dien/i)) {
          console.log(`    Applied to: Every day`);
          schedule.weekday = normalizedSegments;
          schedule.saturday = normalizedSegments;
          schedule.sunday = normalizedSegments;
        } else if (pageText.match(/darba\s+dien/i)) {
          console.log(`    Applied to: Weekdays only`);
          schedule.weekday = normalizedSegments;
        }
        return schedule;
      }
    }
    
    // METHOD 3: Text-based parsing (like Torņakalns)
    // Check for "darba dienās no X līdz Y"
    const weekdayMatch = pageText.match(/darba\s+dienās[^0-9]*(\d{1,2}[.:]\d{2})[^0-9]*līdz[^0-9]*(\d{1,2}[.:]\d{2})/i);
    if (weekdayMatch) {
      console.log(`  Format: Text - weekdays only`);
      const time = normalizeTime(`${weekdayMatch[1]} - ${weekdayMatch[2]}`);
      if (time) {
        schedule.weekday = [time];
      }
    }
    
    // Check for "brīvdienās no X līdz Y"
    const weekendMatch = pageText.match(/brīvdienās[^0-9]*(\d{1,2}[.:]\d{2})[^0-9]*līdz[^0-9]*(\d{1,2}[.:]\d{2})/i);
    if (weekendMatch) {
      console.log(`  Format: Text - with weekend hours`);
      const time = normalizeTime(`${weekendMatch[1]} - ${weekendMatch[2]}`);
      if (time) {
        schedule.saturday = [time];
        schedule.sunday = [time];
      }
    }
    
    // Check if explicitly closed on weekends
    if (pageText.match(/brīvdienās.*slēgts/i) || pageText.match(/svētku\s+dienās.*slēgts/i)) {
      console.log(`  Note: Closed on weekends`);
      schedule.saturday = [];
      schedule.sunday = [];
    }
    
    // Log final result
    console.log(`  Result: ${schedule.weekday.length} weekday segments, ${schedule.saturday.length} weekend segments`);
    
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
  
  // Convert format like "7.20 - 9.35" or "7:20 - 9:35" to "07:20-09:35"
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
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Scraping ${lineId} line...`);
    console.log('='.repeat(50));
    
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
        console.log(`  ⚠ Warning: No schedule data found for ${station.name}`);
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
  console.log('\n' + '='.repeat(50));
  console.log('Starting ViVi schedule scraper...');
  console.log('='.repeat(50));
  
  const data = await scrapeAllStations();
  
  fs.writeFileSync('schedules.json', JSON.stringify(data, null, 2));
  
  console.log('\n' + '='.repeat(50));
  console.log('✓ Schedules saved to schedules.json');
  console.log(`✓ Last updated: ${data.lastUpdated}`);
  console.log('='.repeat(50) + '\n');
}

main().catch(console.error);
