import React, { useState, useEffect, useRef, Component } from 'react';
import { roomCodeFromSearch } from './lib/share-link';
import io from 'socket.io-client';
import './styles/tokens.css';
import './styles/game.css';
import {
  DECK,
  DECLARABLE,
  DRINKS_PER_SHOTGUN,
  ROUND_DURATIONS,
  getCard,
  tierFor,
} from './data/cards';
import { assignAvatars, avatarFor } from './lib/avatars';
import { buildRoundRows, resolvePlayerStats } from './lib/stats';
import { consumedPendingIds, mergePlayerCards } from './lib/players';
import { pourDeltas, readPourPrompt } from './lib/pour';
import { pourPhase } from './lib/phases';
import useEscape from './lib/useEscape';
import { BOARD_IDLE_REVERT_MS, shouldRevertToStandings } from './lib/board';
import { SOCKET_OPTIONS } from './lib/socket-options';
import { sourceLine } from './lib/round-source';
import CallFeed from './components/CallFeed';
import CardDial from './components/CardDial';
import GamePicker from './components/GamePicker';
import LiveScore from './components/LiveScore';
import CardSheet from './components/CardSheet';
import ConnectingScreen from './components/ConnectingScreen';
import DrinkAssigner from './components/DrinkAssigner';
import GameCard from './components/GameCard';
import MenuSheet from './components/MenuSheet';
import RemovePlayerSheet from './components/RemovePlayerSheet';
import Announcement from './components/Announcement';
import ShareResult from './components/ShareResult';
import { shareInvite } from './lib/invite';
import AnnouncementBanner from './components/AnnouncementBanner';
import AgeGate from './components/AgeGate';
import GameOverScreen from './screens/GameOverScreen';
import { unlockAudio, playRoundStart, playRoundEnd, soundEnabled, setSoundEnabled }
  from './lib/sounds';
import { vibrate, createTitleFlasher } from './lib/attention';
import { hasPassed as agePassed, remember as rememberAge } from './lib/age-gate';
import { parseAnnouncement, isDismissed, dismiss as dismissAnnouncementId } from './lib/announcement';
import {
  swappableGroups, toggleSelection, selectedCount, totalSelected, selectionToCards, groupKey,
} from './lib/duplicate-cards';
import Toast from './components/Toast';
import GameScreen from './screens/GameScreen';
import JoinScreen from './screens/JoinScreen';
import LobbyScreen from './screens/LobbyScreen';

/**
 * Table size, matching the printed box ("3-10 PLAYERS"). Both are enforced
 * server-side; these are for what the UI says and offers.
 */
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

/**
 * How long a tap may sit on the phone before it is sent.
 *
 * This is the entire window in which a refresh can still cost you a pour, so it
 * is deliberately short. It is not zero because one emit per tap would put a
 * packet on the wire for every finger-press during a 21-second scramble.
 */
const POUR_FLUSH_MS = 700;


/**
 * Find a player's stats in the `playerStats` map.
 *
 * This was copy-pasted three times in the render. It is one function now, so
 * the call sites cannot drift apart.
 *
 * The unnamed-entry fallback is DELIBERATELY KEPT. It looks dead — the
 * `updatePlayerStats` handler only stores entries that carry a name — but the
 * `gameStarted` handler writes its payload in unfiltered, and the server builds
 * those entries with no `name` field. See FOLLOW_UPS.md F1 and F2: it is
 * reachable, and it stops being reachable only once `gameStarted` is scoped
 * server-side. Do not delete it before then.
 */

// Error Boundary to catch JavaScript crashes
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('💥 CRITICAL CRASH CAUGHT BY ERROR BOUNDARY:', error);
    console.error('💥 Error Info:', errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          backgroundColor: '#1a1a1a',
          color: '#ff6b35',
          fontSize: '18px',
          padding: '20px',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h2>💥 Application Crashed</h2>
          <p>The app encountered an unexpected error and has been reset.</p>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '20px', color: '#ff9999' }}>
            <summary>Error Details (click to expand)</summary>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '12px 24px',
              backgroundColor: '#ff6b35',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * How many suggestions may wait behind the one on screen.
 *
 * A suggestion no longer expires — it is answered or it is not — so the queue
 * needs a ceiling or a backed-up room could stack a whole quarter of prompts
 * in front of the Ref. Past this the OLDEST is discarded: a suggestion about a
 * play four calls ago is noise, and the newest is the one still worth asking.
 */
const MAX_PENDING_SUGGESTIONS = 3;

// SPREAD, always. `io()` hands this object straight to the Manager, which
// writes its default onto it (`opts.path = opts.path || "/socket.io"`).
// SOCKET_OPTIONS is frozen, so passing it directly throws a TypeError here at
// module scope — before React mounts — and the app is a white screen.
const socket = io(
  process.env.REACT_APP_API_URL || 'https://shotgunformation.onrender.com',
  { ...SOCKET_OPTIONS }
);

// const socket = io(process.env.REACT_APP_API_URL || 'http://localhost:3001');

function App() {
  const [gameState, setGameState] = useState('initial');  // 'initial', 'lobby', 'game'
  
  // Debug logging for gameState changes
  useEffect(() => {
    console.log('🔄 GAME STATE CHANGED TO:', gameState);
  }, [gameState]);
  const [playerName, setPlayerName] = useState('');
  // Seeded from a share link so an invited player lands with the code already
  // in the field. Lazy initialiser: read once at mount, never on re-render.
  // Before this, `?room=` was written by handleShareGame and read by nothing,
  // so the recipient got an empty field they also could not type into.
  const [roomCode, setRoomCode] = useState(() => roomCodeFromSearch(
    typeof window !== 'undefined' ? window.location.search : ''
  ));
  const [players, setPlayers] = useState([]);  // Initialize as array
  
  // 🔧 CRITICAL FIX: Use refs to prevent useEffect re-runs from destroying handlers
  const playersRef = useRef([]);
  // The socket handlers below are registered once, so they cannot read
  // `declaredCard` from state without getting the value it had at mount.
  const declaredCardRef = useRef('');
  const roomCodeRef = useRef('');
  /**
   * Pours, tracked twice: what this phone has recorded, and what the server
   * already knows about.
   *
   * Each flush sends the DIFFERENCE, which may be negative. That is what lets
   * undo work for the whole round instead of only for taps that had not been
   * sent yet — a window of under a second, which a player reported as undo
   * simply not working.
   *
   * Pours used to sit locally for the entire round and go out in one batch at
   * the end, which meant a refresh threw them away. Flushing on a short
   * interval keeps that fixed; tracking what was sent is what restores undo.
   */
  const localPoursRef = useRef({ drinks: {}, shotguns: {} });
  const sentPoursRef = useRef({ drinks: {}, shotguns: {} });
  const isDistributingRef = useRef(false);
  const gameStateRef = useRef('initial');

  // ── Live game tracking ──────────────────────────────────────────────────
  // Entirely additive. A room that never attaches a game has `watching` null
  // and every one of these stays empty, so the game behaves exactly as before.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLeague, setPickerLeague] = useState('nfl');
  const [pickerQuery, setPickerQuery] = useState('');
  // The whole slate is the honest default; "Ranked only" is the narrowing
  // option, not the starting view. Defaulting it on hid three quarters of a
  // Saturday behind a checkbox nobody knew to look for.
  const [pickerRanked, setPickerRanked] = useState(false);
  const [gameList, setGameList] = useState([]);
  const [gameListLoading, setGameListLoading] = useState(false);
  const [gameListError, setGameListError] = useState(null);
  const [watching, setWatching] = useState(null);
  const [callEntries, setCallEntries] = useState([]);
  const [callFeedOpen, setCallFeedOpen] = useState(false);
  const [dialOpen, setDialOpen] = useState(false);
  const [cardModes, setCardModes] = useState({});
  const [cardDefaults, setCardDefaults] = useState({});
  const [autoCallPaused, setAutoCallPaused] = useState(false);
  /**
   * Suggestions waiting for the Ref, oldest first.
   *
   * A QUEUE rather than a single slot, and one modal at a time — the same
   * shape the announcement modal uses. A suggestion no longer expires, so two
   * arriving close together would otherwise either stack modals over each
   * other or silently overwrite one another. The head is showing; the rest
   * wait their turn and the modal says how many.
   */
  const [suggestions, setSuggestions] = useState([]);
  // Its own state rather than the round's message, which round logic clears.
  const [feedNotice, setFeedNotice] = useState('');
  // Who started the round now on screen. Null until the server says.
  const [roundSource, setRoundSource] = useState(null);
  
  // Who holds the whistle, as the SERVER last told us. `isHost` is derived from
  // it rather than stored, so there is exactly one thing to keep honest — and
  // the Ref badge can be drawn on whoever actually holds it, not just on you.
  const [hostId, setHostId] = useState(null);
  const isHost = Boolean(hostId) && hostId === socket.id;
  const [errorMessage, setErrorMessage] = useState('');
  const [drinkMessage, setDrinkMessage] = useState(''); // Message for drink assignments
  //const [drinkAssignments, setDrinkAssignments] = useState([]); // Track drink assignments
  const [playerStats, setPlayerStats] = useState({});  // Overall stats
  const [roundDrinkResults, setRoundDrinkResults] = useState({});  // Drinks for the current round
  const [playerNameMap, setPlayerNameMap] = useState({});  // Track ID -> Name mappings
  const [timeRemaining, setTimeRemaining] = useState(0);  // Timer for drink assignment
  const [drinksToGive, setDrinksToGive] = useState(0);  // Track total drinks for this action
  const [shotgunsToGive, setshotgunsToGive] = useState(0);  // Track total shotguns for this action 
  const [assignedDrinks, setAssignedDrinks] = useState({
    drinks: {},     // Track assigned drinks
    shotguns: {}    // Track assigned shotguns
  });
  const [noCardMessage, setNoCardMessage] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Add class to disable game interactions when the menu is open
// const gameElementsClass = isMenuOpen ? 'game-elements-disabled' : '';
  // New state to track if host selection is in progress
const [isHostSelection, setIsHostSelection] = useState(false);
const [isRemovePlayerOpen, setIsRemovePlayerOpen] = useState(false);
    const [isDistributing, setIsDistributing] = useState(false);  // Flag to control drink distribution
  const [hasMatchingCardForCurrentEvent, setHasMatchingCardForCurrentEvent] = useState(false);  // Track if current player has matching card
  //const [drinksAssignedThisRound, setDrinksAssignedThisRound] = useState(0); 
  const [declaredCard, setDeclaredCard] = useState('');
  // Initialize wildCardSelections to store the selected wild card for each player
  const [wildCardSelected, setWildCardSelected] = useState(null);  // Track the selected wild card
  const [quarter, setQuarter] = useState(1); // Track the current quarter
  const [isWildCardSelectionOpen, setIsWildCardSelectionOpen] = useState(false);  // Wild card selection modal state
  const [selectedWildCardToDiscard, setSelectedWildCardToDiscard] = useState(null);  // Track the selected wild card to discard
  // The quarter break: which duplicate copies this player has picked to shed,
  // as { 'deck|card|drinks': count }. Multi-tap cycles a group 0..spare..0, so
  // a mis-tap is undone by carrying on tapping rather than being final.
  const [swapSelection, setSwapSelection] = useState({});
  const [breakOpen, setBreakOpen] = useState(false);
  const [quarterWarning, setQuarterWarning] = useState(null);
  /**
   * The one popup that must be acknowledged. Replaces every `alert()` in this
   * file — see components/Announcement.jsx for why the mechanism mattered.
   *
   * A QUEUE, not a single slot: `newHost` can land while the rules are still
   * up, and the old `alert()` serialised those for free. Dropping the second
   * one would silently lose the whistle notice, which is the one message this
   * whole change exists to deliver.
   */
  const [announcements, setAnnouncements] = useState([]);
  /** The returning-player banner. Null unless the server sent a usable one. */
  const [banner, setBanner] = useState(null);
  /**
   * The age gate. Passed once per device; `agePassed()` returns false when
   * storage is unavailable, so the gate shows — the one place in this session
   * that fails CLOSED.
   */
  const [ageOk, setAgeOk] = useState(() => agePassed());
  /** Final standings, once the game has ended. Non-null means show the curtain call. */
  const [finalStandings, setFinalStandings] = useState(null);
  /** Sound is on by default; a device that turned it off is remembered. */
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  const soundOnRef = useRef(true);
  const flasherRef = useRef(null);
  /** An action held back by the gate, replayed once it is passed. */
  const [afterGate, setAfterGate] = useState(null);
  const [instructionsmessage] = useState('Instructions: \n1. Host will select a card event when an event occurs.\n2. If you have corresponding cards you will be prompted to Assign drinks or shotguns.\n3. Select your Neon Green Wild Card when the event occurs. Host will confirm event\n4. After each Quarter the host will confirm a Quarter has ended and you will have an option to swap out one of your wild cards\n5. Drink responsibly! Must be 21+ Years Old');

  // 🔧 CRITICAL FIX: Sync refs with state to restore functionality
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    isDistributingRef.current = isDistributing;
  }, [isDistributing]);

  useEffect(() => {
    window.hasMatchingCardForCurrentEvent = hasMatchingCardForCurrentEvent;  // For debugging
  }, [hasMatchingCardForCurrentEvent]);
  
  useEffect(() => {
    window.playerStats = playerStats;  // For debugging
    console.log("🔍 DEBUG: playerStats keys and drinks:", Object.entries(playerStats).map(([id, stats]) => ({
      id: id.slice(-4), 
      name: stats.name, 
      totalDrinks: stats.totalDrinks,
      disconnected: stats.disconnected
    })));
  }, [playerStats]);

  // URL management functions
  const updateURL = (roomCode, playerName) => {
    if (roomCode && playerName) {
      const url = new URL(window.location);
      url.searchParams.set('room', roomCode);
      url.searchParams.set('player', playerName);
      window.history.replaceState({}, '', url);
    }
  };

  const getURLParams = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      roomCode: urlParams.get('room'),
      playerName: urlParams.get('player')
    };
  };

  /** Where a game in progress is remembered across a reload. */
  const SAVED_GAME_KEY = 'shotgunFormation_gameState';

  /**
   * Forget the saved game.
   *
   * Nothing used to remove this key. It was written every 15 seconds and lived
   * forever, so once its room was gone the app walked back into the same failed
   * rejoin on every single load. Every path that ends a game calls this.
   */
  const forgetSavedGame = () => {
    try {
      localStorage.removeItem(SAVED_GAME_KEY);
    } catch (error) {
      console.error('Failed to clear saved game state:', error);
    }
  };

  const clearURL = () => {
    const url = new URL(window.location);
    url.searchParams.delete('room');
    url.searchParams.delete('player');
    window.history.replaceState({}, '', url);
  };



  // Start a new game (Create Room)
  const startGame = () => {
    if (!playerName.trim()) {
      setErrorMessage('Please enter your name first');
      return;
    }
    announce('How to play', instructionsmessage);
    if (playerName) {
      socket.emit('createRoom', playerName);
    } else {
      setErrorMessage('Please enter your name');
    }
  };

  const joinGame = () => {
    if (!playerName.trim()) {
      setErrorMessage('Please enter your name first');
      return;
    }
    
    // ✅ FIX: Prioritize form input over URL params for manual room entry
    const urlParams = getURLParams();
    const currentRoomCode = roomCode.trim() || urlParams.roomCode; // Form input takes priority
    
    if (!currentRoomCode.trim()) {
      setErrorMessage('Please enter a room code');
      return;
    }
    if (currentRoomCode && playerName) {
      setRoomCode(currentRoomCode); // Set the room code state
      socket.emit('joinRoom', currentRoomCode, playerName);
      
      // ✅ FIX: Update URL with new room code (clears old URL params)
      updateURL(currentRoomCode, playerName);
  
      // ✅ FIX: Removed old conflicting gameStarted handler - main handler will process
    } else {
      setErrorMessage('Please enter a valid room code and your name');
    }
  };

  // Start the game (only for the host)
  const startTheGame = () => {
    if (isHost && players.length >= 3) {
      socket.emit('startGame', roomCode);
      // Update URL for host when starting the game
      updateURL(roomCode, playerName);
    }
  };

  // Handle leave lobby
  const leaveLobby = () => {
    if (roomCode) {
      socket.emit('leaveRoom', roomCode);
    }
    setGameState('initial');
    setRoomCode('');
    setPlayers([]);  // Reset players to empty array
    clearURL();  // Clear URL when manually leaving so they can join new games
  };

// Handle card click from the host
const handleCardClick = (cardType) => {
  if (isHost) {
    if (cardType === 'First Down') {
      // Emit a special event for First Down to let everyone know they need to drink once
      socket.emit('firstDownEvent', { roomCode });
      console.log('First Down - Everyone drinks once!');
    } else {
      // Emit the usual event for any other card
      socket.emit('playStandardCard', { roomCode, cardType });
      console.log(`Host declared card: ${cardType}`);  // Log the declared card
    }
    setIsActionModalOpen(false)
  }
};
// Handle wild card selection
const handleWildCardSelect = (wildcardtype) => {
  console.log(`🃏 Player clicked wild card: ${wildcardtype}`);
  console.log(`🃏 Emitting wildCardSelected with roomCode: ${roomCode}, playerId: ${socket.id}`);
  
  socket.emit('wildCardSelected', { roomCode, playerId: socket.id, wildcardtype });
  console.log(`🃏 Wild card selection emitted to server`);
};
const confirmWildCard = (confirm) => {
  if (confirm && wildCardSelected) {
    // Emit to the server that the host confirmed the wild card action
    socket.emit('wildCardConfirmed', { roomCode, wildcardtype: wildCardSelected.wildcardtype, player: wildCardSelected.player });
    console.log(`✅ Host confirmed wild card: ${wildCardSelected.wildcardtype} by player ${wildCardSelected.player}`);
  } else {
    console.log(`❌ Host rejected wild card: ${wildCardSelected?.wildcardtype} by player ${wildCardSelected?.player}`);
    // TODO: Could emit rejection event to notify players
  }
  setWildCardSelected(null);  // Reset after confirming or denying
};


// Handle giving out drinks or shotguns
const handleGiveDrink = (selectedPlayerId, type) => {
  console.log(`Button clicked to assign ${type} to Player ID: ${selectedPlayerId}`);  // Log the click
  let localDrinksAssigned = false;  // Local flag to ensure drinks/shotguns are only assigned once per execution
  console.log("Initial State:", localDrinksAssigned, "Drinks to Give:", drinksToGive, "Shotguns to Give:", shotgunsToGive);

  setAssignedDrinks((prev) => {
    // Initialize or update drinks and shotguns separately
    const updatedDrinks = { ...prev.drinks, [selectedPlayerId]: (prev.drinks?.[selectedPlayerId] || 0) + (type === 'drink' ? 1 : 0) };
    const updatedShotguns = { ...prev.shotguns, [selectedPlayerId]: (prev.shotguns?.[selectedPlayerId] || 0) + (type === 'shotgun' ? 1 : 0) };

    // Calculate the total assigned drinks and shotguns so far
    const totalAssignedDrinks = Object.values(updatedDrinks).reduce((acc, cur) => acc + cur, 0);
    const totalAssignedShotguns = Object.values(updatedShotguns).reduce((acc, cur) => acc + cur, 0);

    // Ensure that we don't assign more drinks or shotguns than available
    if (
      (type === 'drink' && totalAssignedDrinks > drinksToGive) ||
      (type === 'shotgun' && totalAssignedShotguns > shotgunsToGive)
    ) {
      console.log(`Cannot assign more ${type}s. Max ${type}s to give:`, type === 'drink' ? drinksToGive : shotgunsToGive);
      return prev;  // Return the previous state without updating if over limit
    }

    console.log(`Selected Player ID: ${selectedPlayerId}, Drinks: ${updatedDrinks[selectedPlayerId]}, Shotguns: ${updatedShotguns[selectedPlayerId]}`);

    // Combine all selected player IDs that received either drinks or shotguns
    const allSelectedPlayerIds = [
      ...new Set([...Object.keys(updatedDrinks), ...Object.keys(updatedShotguns)])
    ];

    // Log the updated drinks and shotguns per player
    console.log("Total Assigned Drinks:", totalAssignedDrinks);
    console.log("Total Assigned Shotguns:", totalAssignedShotguns);

    // Update the state with the new drink/shotgun assignments
    setAssignedDrinks({ drinks: updatedDrinks, shotguns: updatedShotguns });

    // Send the drink and shotgun assignments once the totals match the available drinks and shotguns
    /*
    if ((totalAssignedDrinks === drinksToGive && totalAssignedShotguns === shotgunsToGive) && !localDrinksAssigned) {
      socket.emit('assignDrinks', {
        roomCode,  // Room code to identify the game
        selectedPlayerIds: allSelectedPlayerIds,  // All player IDs receiving drinks/shotguns
        drinksToGive: updatedDrinks,  // The entire set of drink assignments
        shotgunsToGive: updatedShotguns  // The entire set of shotgun assignments
      });
      localDrinksAssigned = true;
      console.log("Local Drinks Assigned Flag:", localDrinksAssigned);
      console.log(`Assignment complete for player: ${selectedPlayerId}`);
    }
*/

    // Return the updated state
    return { drinks: updatedDrinks, shotguns: updatedShotguns };
  });
};

// Toggle the menu display
const toggleMenu = () => {
  setIsMenuOpen(!isMenuOpen);
};

// Handle showing the instructions
const handleShowInstructions = () => {
  setIsMenuOpen(false);
  announce('How to play', instructionsmessage);
};
//handle declare action
const handleDeclareAction = () => {
  // This function will open the modal or trigger any action logic you have
  setIsActionModalOpen(true); // Example to open a modal
};
// Handle host swap button click
const handleHostSwap = () => {
  if (isHost) {
    setIsHostSelection(true);  // Start the host selection process
  }
};
// Handle selecting a new host from the available players
const handleSelectNewHost = (playerId) => {
  // Ask, then wait. Host status changes ONLY when the server's `newHost` event
  // arrives — the handler for it sets isHost for everyone in the room.
  //
  // This used to call setIsHost(false) and close the sheet immediately. If the
  // server refused (the target had dropped out), the Ref's own screen gave up
  // the whistle anyway: nobody at the table believed they were Ref, only the
  // Ref can declare, and the game stopped — from the exact code path meant to
  // prevent that.
  setErrorMessage('');
  setHandoffPending(playerId);
  socket.emit('assignNewHost', { roomCode, newHostId: playerId });
};

// Close the host selection modal without action
const closeHostSelection = () => {
  setIsHostSelection(false);
};

/**
 * Give up on rejoining and go back to the start screen.
 *
 * Used by the ten-second bail-out, by a rejoin that fails outright, and by the
 * button on the connecting screen. All three have to forget the saved game as
 * well as the URL, or the next load lands on the same dead room.
 */
/**
 * Give up on an automatic rejoin and hand back a join screen that works.
 *
 * The requirement is that nobody is ever left on a spinner. Landing on a blank
 * form with no explanation is only marginally better, so this carries a reason
 * and the join screen shows it.
 *
 * `reason` is guarded because this is also wired straight to a button's
 * onClick, which would otherwise pass a React event as the message.
 */
const abandonRejoin = (reason) => {
  // Keep the code from the link, if there was one, so a retry does not mean
  // typing it again. Read BEFORE clearURL, which strips the params.
  const fromLink = roomCodeFromSearch(window.location.search);
  forgetSavedGame();
  clearURL();
  setRoomCode(fromLink);
  setPlayers([]);
  setHostId(null);
  setErrorMessage(typeof reason === 'string' && reason ? reason : '');
  setGameState('initial');
};

// ── Live game tracking handlers ───────────────────────────────────────────

/** A stable, human key for a feed entry, so React does not reorder rows. */
let callSeq = 0;
const clockNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const openPicker = (league = pickerLeague) => {
  setPickerOpen(true);
  requestGames(league);
};

const requestGames = (league) => {
  setPickerLeague(league);
  setGameListLoading(true);
  setGameListError(null);
  socket.emit('listGames', { league });
};

const handlePickGame = (game) => {
  if (!game || !game.id) return;
  socket.emit('attachGame', { roomCode: roomCodeRef.current, league: game.league || pickerLeague, gameId: game.id });
  setPickerOpen(false);
};

const handleDetachGame = () => {
  socket.emit('detachGame', { roomCode: roomCodeRef.current });
};

const handleCardMode = (cardId, mode) => {
  socket.emit('setCardMode', { roomCode: roomCodeRef.current, cardId, mode });
};

const handlePauseAutoCall = (paused) => {
  socket.emit('pauseAutoCall', { roomCode: roomCodeRef.current, paused });
};

/** Drop one suggestion from the queue, whichever way it was answered. */
const dropSuggestion = (offer) => setSuggestions((prev) =>
  prev.filter((x) => !(x.cardId === offer.cardId && x.playId === offer.playId)));

const handleAcceptSuggestion = (offer) => {
  if (!offer) return;
  // Unchanged wire call: the modal replaced the prompt, not the contract.
  socket.emit('acceptSuggestion', { roomCode: roomCodeRef.current, cardId: offer.cardId });
  dropSuggestion(offer);
};

/**
 * "Skip" is an ANSWER, and only to this one.
 *
 * Nothing is emitted: the server offered, the Ref declined, and declining is
 * the absence of a declaration. What it must not do is clear the rest of the
 * queue — each suggestion is its own question.
 */
const handleSkipSuggestion = (offer) => {
  if (!offer) return;
  dropSuggestion(offer);
};

// Handle Leave Game logic
const handleLeaveGame = () => {
  // Emit a custom 'leaveGame' event to the server
  socket.emit('leaveGame', { roomCode });  // Send the roomCode to the server

  // Reset the frontend game state and return to the start/join screen
  setGameState('initial');  // Reset the game state to 'startOrJoin'
  setRoomCode('');  // Clear the room code
  setPlayers([]);  // Reset players
  setHostId(null);  // Reset host status
  setDeclaredCard('');  // Clear declared card
  forgetSavedGame();  // ...and do not try to rejoin this game on the next load
  clearURL();
  setWatching(null);   // a game you have left is not a game you are watching
  setCallEntries([]);
  setSuggestions([]);
  setAutoCallPaused(false);
};

// Function to close the menu (X button)
const closeMenu = () => {
  setIsMenuOpen(false);
};

/** Ref-only: open the remove sheet. The confirm lives inside the sheet. */
const openRemovePlayer = () => {
  setIsMenuOpen(false);
  setIsRemovePlayerOpen(true);
};

const handleRemovePlayer = (playerId) => {
  socket.emit('removePlayer', { roomCode, playerId });
  setIsRemovePlayerOpen(false);
};

/**
 * Queue something the player must acknowledge.
 *
 * Defined via the setter's callback form so it never reads a stale queue: it
 * is called from socket handlers registered in a []-deps effect, and closing
 * over `announcements` there would freeze it at [] forever — the Session 8
 * mistake, in a new place.
 */
const announce = (title, body, dismissText) => {
  setAnnouncements((queue) => [...queue, { title, body, dismissText }]);
};

const dismissAnnouncement = () => setAnnouncements((queue) => queue.slice(1));

/**
 * One tap to invite. Item 2 of Session 18.
 *
 * `shareInvite` tries the OS share sheet, then the clipboard. The result is
 * SHOWN either way — a silent clipboard write reads as a dead button, which is
 * the same lost player this exists to prevent.
 */
const handleInvite = async () => {
  setIsMenuOpen(false);
  const how = await shareInvite(roomCodeRef.current || roomCode);
  if (how === 'copied') {
    announce('Invite copied', 'Paste it to whoever you want in. The link carries the room code.');
  } else if (how === 'failed') {
    announce('Could not share', `Read them the room code instead: ${roomCodeRef.current || roomCode}`);
  }
};

/** The Ref finishes the game for everyone. */
/**
 * Unlock audio on a REAL user gesture.
 *
 * This is the part that silently does not work anywhere else. Browsers block
 * audio until the user has interacted, and iOS Safari is strictest: a context
 * created before a gesture starts `suspended` and every sound fails with no
 * error and nothing to debug.
 *
 * Called from creating a room, joining one, and passing the age gate — all
 * real taps, all before any round can start. Safe to call repeatedly.
 */
const unlockOnGesture = () => { unlockAudio(); };

const toggleSound = () => {
  const next = !soundOnRef.current;
  setSoundOn(next);
  setSoundEnabled(next);
  // Turning it ON is itself a gesture, so take the chance to unlock.
  if (next) unlockAudio();
};

const handleEndGame = () => {
  setIsMenuOpen(false);
  socket.emit('endGame', { roomCode: roomCodeRef.current || roomCode });
};

/** Same room, same people, scores cleared. Ref-only, like startGame. */
const handlePlayAgain = () => {
  socket.emit('playAgain', { roomCode: roomCodeRef.current || roomCode });
};

const handleShareGame = () => {
  const gameUrl = `${window.location.origin}?room=${roomCode}`;
  const shareText = `Join my Shotgun Formation game! Room Code: ${roomCode}\n\nClick here to join: ${gameUrl}`;
  
  if (navigator.share) {
    navigator.share({
      title: 'Shotgun Formation Game',
      text: shareText,
      url: gameUrl
    }).catch(err => console.log('Error sharing:', err));
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(shareText).then(() => {
      announce('Link copied', 'The game link is on your clipboard — paste it to whoever you want in.');
    }).catch(err => {
      console.log('Error copying to clipboard:', err);
      fallbackCopyTextToClipboard(shareText);
    });
  } else {
    fallbackCopyTextToClipboard(shareText);
  }
  setIsMenuOpen(false);
};

const fallbackCopyTextToClipboard = (text) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    announce('Link copied', 'The game link is on your clipboard — paste it to whoever you want in.');
  } catch (err) {
    // Copying failed, so the link itself has to be readable on screen.
    announce('Share this link', text);
  }
  document.body.removeChild(textArea);
};


  // Handle "Next QTR" action from the host
  const handleNextQuarter = () => {
    setIsActionModalOpen(false);
    requestNextQuarter();
  };

const [actionMessage, setActionMessage] = useState('');  // Store messages like "Action in progress"

// ── UI state introduced by the mockup port ────────────────────────────────
const [boardTab, setBoardTab] = useState('stand');      // 'stand' | 'last'
const [boardPulse, setBoardPulse] = useState(false);    // pulse the Round Results tab
const [boardPinned, setBoardPinned] = useState(false);  // the owner opened a tab by hand
const [lastRoundCard, setLastRoundCard] = useState(null);
const [lastRoundRows, setLastRoundRows] = useState([]);
const [openCard, setOpenCard] = useState(null);         // full-card sheet
const [pourSent, setPourSent] = useState(false);        // locked in, early or by expiry
const [pourStack, setPourStack] = useState([]);         // for UNDO, newest last
const [tileAnim, setTileAnim] = useState({});           // per-tile hit/deny animation
const [toastMessage, setToastMessage] = useState('');
const [handoffPending, setHandoffPending] = useState(null);  // awaiting the server's newHost

useEffect(() => { declaredCardRef.current = declaredCard; }, [declaredCard]);

// Escape closes whichever sheet is open. Cancel-or-Escape is the pattern;
// scrim-click is deliberately absent (see lib/useEscape.js).
//
// These sit up here with the other effects, not down in the render, because
// the render has early returns for the join/lobby/connecting screens and a
// hook after an early return breaks the rules-of-hooks ordering. Every
// callback is wrapped so nothing is read before it is defined.
useEscape(isActionModalOpen, () => closeModal('actionModal'));
useEscape(isWildCardSelectionOpen, () => closeModal('wildCardSelection'));
useEscape(isHostSelection, () => closeHostSelection());
useEscape(isMenuOpen, () => closeMenu());
useEscape(!!openCard, () => setOpenCard(null));
useEscape(!!wildCardSelected && isHost, () => confirmWildCard(false));
useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);
// The auto-rejoin effect runs once and its timeouts fire ten seconds later,
// long after their closure went stale. They read the game state from here.
useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

/**
 * The tab title stops flashing the moment somebody looks at the tab.
 * `document.hidden` and `visibilitychange`, nothing more — no permission, no
 * service worker.
 */
useEffect(() => {
  if (!flasherRef.current) flasherRef.current = createTitleFlasher();
  const onVisible = () => { if (!document.hidden) flasherRef.current.stop(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    if (flasherRef.current) flasherRef.current.stop();
  };
}, []);

// No expiry effect, deliberately. A suggestion is answered or it is not; it
// does not quietly stop existing. See SuggestionModal for why.


/**
 * A round starting answers every pending suggestion by overtaking it.
 *
 * Whether the Ref declared by hand or an auto-call fired, the table has moved
 * on — and a modal asking about the play before last is worse than no modal.
 * This is the release valve that makes a never-expiring prompt safe: it cannot
 * outlive its moment, it just cannot vanish WITHOUT one.
 */
useEffect(() => {
  if (!declaredCard) return;
  setSuggestions([]);
}, [declaredCard]);

// The one-off "the feed is calling" line clears itself.
useEffect(() => {
  if (!feedNotice) return undefined;
  const timer = setTimeout(() => setFeedNotice(''), 12000);
  return () => clearTimeout(timer);
}, [feedNotice]);

/**
 * The handoff sheet closes when the server confirms, not when the Ref taps.
 * On refusal it stays open with the reason, and the Ref keeps the whistle.
 */
useEffect(() => {
  if (!handoffPending) return undefined;
  if (!isHost) { setHandoffPending(null); setIsHostSelection(false); }
  return undefined;
}, [isHost, handoffPending]);

/**
 * Round Results is a bulletin, not a home screen.
 *
 * The board flips itself there when a round lands, which is right — that is
 * the moment everyone looks down. But it is the wrong thing to be staring at
 * while waiting for the next call, so it falls back to Standings once nothing
 * has happened for a while.
 *
 * Two things cancel it: a new round starting (the flip is about to happen
 * again anyway) and the player opening a tab THEMSELVES. If someone
 * deliberately opened Round Results to argue about a pour, yanking it away
 * mid-argument is worse than leaving it.
 */
useEffect(() => {
  if (!shouldRevertToStandings({ boardTab, boardPinned, declaredCard, timeRemaining })) {
    return undefined;
  }
  const id = setTimeout(() => setBoardTab('stand'), BOARD_IDLE_REVERT_MS);
  return () => clearTimeout(id);
}, [boardTab, boardPinned, declaredCard, timeRemaining]);
// ✅ REMOVED isRefreshProcessing - no longer needed since triggerPersonalRefresh removed

// Handle opening the wild card selection modal
const openWildCardSelection = () => {
  setIsWildCardSelectionOpen(true);
};

// Handle selecting a wild card to discard
const handleSelectWildCardToDiscard = (card) => {
  setSelectedWildCardToDiscard(card);  // Store the selected card to discard
  console.log("Wild card selected", selectedWildCardToDiscard);

};

/**
 * Confirm the break: shed every selected duplicate in ONE action.
 *
 * Still one confirm per player per quarter — the Session 3 guard is unchanged,
 * it just now covers a whole selection instead of a single card. `swapDone`
 * carries the "I have finished with the break" signal in both directions, so
 * the server can close the break without waiting out its timeout.
 */
const confirmSwap = () => {
  // playersRef, not `players`: this handler is defined once and the roster it
  // closes over would otherwise be frozen — the Session 8 mistake.
  const me = (playersRef.current || []).find((p) => p.id === socket.id);
  const groups = swappableGroups((me && me.cards) ? me.cards : {});
  const cards = selectionToCards(swapSelection, groups);
  if (cards.length > 0) {
    socket.emit('swapDuplicates', { roomCode, cards });
  } else {
    socket.emit('swapDone', { roomCode });
  }
  setIsWildCardSelectionOpen(false);
  setSwapSelection({});
  setSelectedWildCardToDiscard(null);
};

/** Closed the sheet without shedding anything. Still an answer — one path. */
const dismissSwap = () => closeModal('wildCardSelection');

/** Tap a duplicate: one more copy, wrapping back to none past the last spare. */
const toggleSwapCard = (group) => {
  setSwapSelection((prev) => toggleSelection(prev, group));
};

/**
 * The Ref turning the quarter over by hand.
 *
 * Two things are worth interrupting for, and only two: a round is running, or
 * a game is attached and the real game is not on the quarter this would move
 * to. Anything else advances without a prompt.
 */
const requestNextQuarter = () => {
  if (!isHost) return;
  const nextQ = (quarter || 1) + 1;
  const feedPeriod = watching && Number(watching.period);
  const reasons = [];
  if (timeRemaining > 0 || declaredCard) {
    reasons.push('A round is running — advancing now will end it.');
  }
  if (Number.isFinite(feedPeriod) && feedPeriod > 0 && feedPeriod !== nextQ) {
    reasons.push(`The game you are watching is in Q${feedPeriod}, not Q${nextQ}.`);
  }
  if (reasons.length > 0) {
    setQuarterWarning(reasons);
    return;
  }
  socket.emit('nextQuarter', { roomCode });
};

/** The Ref said yes to the warning. */
const forceNextQuarter = () => {
  setQuarterWarning(null);
  socket.emit('nextQuarter', { roomCode, force: true });
};
const closeModal = (modalType) => {
  switch (modalType) {
    case 'timerModal':
    case 'drinkAssignmentModal':
      setTimeRemaining(0);  // Close the timer and drink assignment modal
      setIsDistributing(false);  // Stop distributing drinks
      break;
    case 'firstDownModal':
      setDeclaredCard(null);  // Clear the first down modal
      break;
    case 'wildCardSelection':
      // Declining the quarter-break swap. The allowance is untouched — it is
      // only consumed by an actual swap, so keeping your hand costs nothing
      // and next quarter still offers one.
      //
      // But the server IS told, because "dismissed" is an answer and the break
      // closes once everyone has given one. Session 20 shipped this without
      // the emit and a player who pressed Escape or tapped the scrim silently
      // held the whole table for the full 45-second timeout. Caught in a
      // browser: the server log read "the break timed out" when three people
      // had all finished.
      setIsWildCardSelectionOpen(false);
      setSelectedWildCardToDiscard(null);
      setSwapSelection({});
      if (roomCodeRef.current) socket.emit('swapDone', { roomCode: roomCodeRef.current });
      break;
    case 'actionModal':
      // Backing out of Declare Action. Must NOT declare anything.
      setIsActionModalOpen(false);
      break;
    default:
      // A modal type with no case here is a DEAD BUTTON — whatever called it
      // silently did nothing. That is how "Keep my hand" and the Declare
      // Action scrim both shipped broken. tests/ui/modals.test.jsx now fails
      // if a call site has no case, so this branch should stay unreachable.
      console.warn(`closeModal: nothing handles "${modalType}" — the control that called it did nothing.`);
      break;
  }
};

// In your App.js, update the saveGameStateLocally function
const saveGameStateLocally = () => {
  try {
    if (players.length > 0 && roomCode) {
      // Create a simplified state object that won't cause circular reference errors
      const localGameState = {
        players: players.map(p => ({
          id: p.id,
          name: p.name,
          disconnected: p.disconnected || false,
          // Only include essential card data
          cards: p.cards ? {
            standard: p.cards.standard ? p.cards.standard.map(c => ({ card: c.card, drinks: c.drinks })) : [],
            wild: p.cards.wild ? p.cards.wild.map(c => ({ card: c.card, drinks: c.drinks })) : []
          } : { standard: [], wild: [] }
        })),
        currentPlayerName: playerName, // Store current player name explicitly
        roomCode,
        quarter,
        isHost,
        // Simplify playerStats to avoid circular references
        playerStats: Object.entries(playerStats).reduce((acc, [id, stats]) => {
          acc[id] = {
            name: stats.name || players.find(p => p.id === id)?.name,
            totalDrinks: stats.totalDrinks || 0,
            totalShotguns: stats.totalShotguns || 0
          };
          return acc;
        }, {}),
        timestamp: Date.now()
      };
      
      localStorage.setItem(SAVED_GAME_KEY, JSON.stringify(localGameState));
      console.log('Game state saved locally');
    }
  } catch (error) {
    console.error('Failed to save game state locally:', error);
  }
};

const loadGameStateLocally = () => {
  try {
    const savedState = localStorage.getItem(SAVED_GAME_KEY);
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      const isStale = Date.now() - parsedState.timestamp > 1000 * 60 * 30; // 30 minutes
      
      if (!isStale && parsedState.roomCode === roomCode) {
        return parsedState;
      }
    }
  } catch (error) {
    console.error('Failed to load game state locally:', error);
  }
  return null;
};

// Automatic rejoin on app load - ALWAYS check URL first
useEffect(() => {
  console.log('🔄 APP MOUNT: Starting auto-rejoin logic...');
  console.log('Current gameState:', gameState);
  console.log('Socket connected:', socket.connected);
  console.log('Window location:', window.location.href);
  console.log('Document ready state:', document.readyState);
  
  // CRITICAL: Ensure gameState is never undefined during rejoin
  if (!gameState || gameState === '') {
    console.warn('⚠️ GameState is invalid during mount, forcing to initial');
    setGameState('initial');
    return;
  }

  // 🛡️ SAFETY: Add timeout to prevent auto-rejoin from blocking initial render
  const autoRejoinTimeout = setTimeout(() => {
    console.log('🛡️ Auto-rejoin safety timeout triggered - ensuring initial state if nothing happened');
    if (gameState === 'initial' && !playerName && !roomCode) {
      console.log('🛡️ Confirming initial state after timeout');
      // App is still in pristine initial state, which is correct
    }
  }, 2000);

  // Cleanup timeout on unmount
  const cleanup = () => {
    clearTimeout(autoRejoinTimeout);
  };
  
  const urlParams = getURLParams();
  const localState = loadGameStateLocally();
  
  console.log('URL params:', urlParams);
  console.log('Local state:', localState);
  
  // Add a flag to prevent multiple rejoin attempts
  let rejoinAttempted = false;
  
  // PRIORITY 1: Always check URL params first (highest priority) - NO MORE FORCED REFRESH
  if (urlParams.roomCode && urlParams.playerName && !rejoinAttempted) {
    console.log('🔄 DEBUG: Device connected with URL params - attempting direct rejoin:', urlParams);
    console.log('🔄 DEBUG: Socket ID at rejoin start:', socket.id);
    console.log('🔄 DEBUG: rejoinAttempted flag:', rejoinAttempted);
    setPlayerName(urlParams.playerName);
    setRoomCode(urlParams.roomCode);
    setGameState('connecting');
    rejoinAttempted = true;
    
    // Validate and rejoin directly without page refresh - wait for socket connection
    const validateTimeout = setTimeout(() => {
      console.log('Direct rejoin: checking socket connection...');
      
      if (socket.connected) {
        console.log('🔄 DEBUG: Socket connected - validating game and rejoining');
        console.log('🔄 DEBUG: Socket ID before validateAndJoinRoom:', socket.id);
        socket.emit('validateAndJoinRoom', urlParams.roomCode, urlParams.playerName);
      } else {
        console.log('🔄 DEBUG: Socket not connected - waiting for connection...');
        socket.once('connect', () => {
          console.log('🔄 DEBUG: Socket connected after wait - validating game and rejoining');
          console.log('🔄 DEBUG: Socket ID after connect:', socket.id);
          socket.emit('validateAndJoinRoom', urlParams.roomCode, urlParams.playerName);
        });
      }
    }, 1000); // Give socket time to connect
    
    // Listen for successful rejoin (NO MORE REFRESHING)
    const handleRejoinSuccess = () => {
      console.log('Post-refresh rejoin successful - entering game');
      setGameState('game');
    };
    
    const handleLobbyJoin = () => {
      console.log('Post-refresh rejoin successful - entering lobby');
      setGameState('lobby');
    };
    
    const handleRejoinError = (error) => {
      console.log('Auto-rejoin failed:', error, '- going to join screen');
      abandonRejoin('That game is no longer running. Check the room code, or start a new game.');
    };
    
    // ✅ FIX: Remove competing gameStarted handler - let main handler process cards
    socket.once('joinedRoom', handleLobbyJoin);
    socket.once('roomNotFound', handleRejoinError);
    socket.once('error', handleRejoinError);
    
    // Cleanup listeners and timeout after 10 seconds
    setTimeout(() => {
      clearTimeout(validateTimeout);
      // ✅ FIX: Remove cleanup for competing gameStarted handler
      socket.off('joinedRoom', handleLobbyJoin);
      socket.off('error', handleRejoinError);
      // roomNotFound is deliberately NOT removed. It is a `once`, so it cleans
      // itself up when it fires, and it used to be torn down here — which left
      // a late answer from the server with nobody listening.
      
      // If still connecting after 10 seconds, assume failure
      if (gameStateRef.current === 'connecting') {
        console.log('Auto-rejoin timed out - going to join screen');
        abandonRejoin('We could not get you back into that game. Check the room code and try again.');
      }
    }, 10000);
    
  } else if (localState && localState.roomCode && localState.currentPlayerName && !rejoinAttempted) {
    // PRIORITY 2: Try to rejoin from local storage - direct rejoin without refresh
    console.log('No URL params - attempting rejoin from localStorage:', localState.currentPlayerName);
    setPlayerName(localState.currentPlayerName);
    setRoomCode(localState.roomCode);
    setGameState('connecting');
    rejoinAttempted = true;
    
    // Update URL for future reference
    updateURL(localState.roomCode, localState.currentPlayerName);
    
    // Validate and rejoin directly - wait for socket connection
    const validateTimeout = setTimeout(() => {
      console.log('LocalStorage rejoin: checking socket connection...');
      
      if (socket.connected) {
        console.log('Socket connected - validating game and rejoining');
        socket.emit('validateAndJoinRoom', localState.roomCode, localState.currentPlayerName);
      } else {
        console.log('Socket not connected - waiting for connection...');
        socket.once('connect', () => {
          console.log('Socket connected after wait - validating game and rejoining');
          socket.emit('validateAndJoinRoom', localState.roomCode, localState.currentPlayerName);
        });
      }
    }, 1000);
    
    // Use the same event handlers as URL rejoin
    const handleRejoinSuccess = () => {
      console.log('LocalStorage rejoin successful - entering game');
      setGameState('game');
    };
    
    const handleLobbyJoin = () => {
      console.log('LocalStorage rejoin successful - entering lobby');
      setGameState('lobby');
    };
    
    const handleRejoinError = (error) => {
      console.log('LocalStorage rejoin failed:', error, '- going to join screen');
      abandonRejoin('Your last game has finished. Start a new one, or join with a room code.');
    };
    
    // ✅ FIX: Remove competing gameStarted handler - let main handler process cards
    socket.once('joinedRoom', handleLobbyJoin);
    socket.once('roomNotFound', handleRejoinError);
    socket.once('error', handleRejoinError);
    
    // Cleanup after timeout
    setTimeout(() => {
      clearTimeout(validateTimeout);
      // ✅ FIX: Remove cleanup for competing gameStarted handler
      socket.off('joinedRoom', handleLobbyJoin);
      socket.off('error', handleRejoinError);
      // See above: roomNotFound stays registered.
      
      if (gameStateRef.current === 'connecting') {
        console.log('LocalStorage rejoin timed out - going to join screen');
        abandonRejoin('We could not reach your last game. Start a new one, or join with a room code.');
      }
    }, 10000);
    
  } else {
    // PRIORITY 3: No saved game data found - go to start screen
    console.log('No saved game data found - showing start/join screen');
    setGameState('initial');
  }

  // Return cleanup function
  return cleanup;
}, []); // Only run on mount

// Call saveGameStateLocally periodically
useEffect(() => {
  if (gameState === 'game') {
    // Save game state every 15 seconds
    const saveInterval = setInterval(saveGameStateLocally, 15000);
    return () => clearInterval(saveInterval);
  }
}, [gameState, players, playerStats, roomCode, quarter]);

// ✅ DEBUG: Track main event handler setup timing
useEffect(() => {
  console.log('🔧 DEBUG: Main event handlers useEffect starting - setting up gameStarted handler');
  console.log('🔧 DEBUG: Socket connected status:', socket.connected);
  console.log('🔧 DEBUG: Current socket ID:', socket.id);
}, []);

// Enhanced connection monitoring with network change detection
useEffect(() => {
  let lastConnectedStatus = socket.connected;
  let disconnectTime = null;
  
  const checkConnection = () => {
    // Connection state changed
    if (lastConnectedStatus !== socket.connected) {
      if (socket.connected) {
        const reconnectTime = Date.now();
        const downtime = disconnectTime ? (reconnectTime - disconnectTime) / 1000 : null;
        console.log(`Connection restored after ${downtime} seconds of downtime`);
        disconnectTime = null;
        
        // Request game state after reconnection
        if (gameState === 'game' && roomCode) {
          setTimeout(() => {
            socket.emit('requestGameState', { roomCode, playerName });
          }, 1000);
        }
      } else {
        disconnectTime = Date.now();
        console.log('Connection lost at:', new Date(disconnectTime).toISOString());
        
        // Save game state when connection is lost
        if (gameState === 'game') {
          saveGameStateLocally();
        }
      }
      lastConnectedStatus = socket.connected;
    }
  };
  
  // Network change detection for mobile
  const handleNetworkChange = () => {
    console.log('Network status changed. Online:', navigator.onLine);
    
    if (navigator.onLine && !socket.connected) {
      console.log('Network restored, attempting to reconnect...');
      setTimeout(() => {
        socket.connect();
      }, 1000);
    } else if (!navigator.onLine) {
      console.log('Network lost, saving game state...');
      if (gameState === 'game') {
        saveGameStateLocally();
      }
    }
  };
  
  // Check connection every second
  const interval = setInterval(checkConnection, 1000);
  
  // Listen for network changes (mobile-friendly)
  window.addEventListener('online', handleNetworkChange);
  window.addEventListener('offline', handleNetworkChange);
  
  return () => {
    clearInterval(interval);
    window.removeEventListener('online', handleNetworkChange);
    window.removeEventListener('offline', handleNetworkChange);
  };
}, [socket, gameState, roomCode]);

// Add this to your useEffect in App.js
useEffect(() => {
  // Handle server heartbeat
  const handleHeartbeat = (data) => {
    // Respond to server heartbeat to keep connection alive
    socket.emit('heartbeat-ack', { timestamp: data.timestamp });
  };
  
  socket.on('heartbeat', handleHeartbeat);
  
  return () => {
    socket.off('heartbeat', handleHeartbeat);
  };
}, [socket]);


// Enhanced mobile visibility and wake lock handling
useEffect(() => {
  let wakeLock = null;
  
  // Request wake lock to prevent mobile from sleeping during gameplay
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && gameState === 'game') {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake lock acquired for better mobile connectivity');
        
        wakeLock.addEventListener('release', () => {
          console.log('Wake lock released');
        });
      } catch (err) {
        console.log('Wake lock failed:', err);
      }
    }
  };

  // Release wake lock when leaving game
  const releaseWakeLock = () => {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      console.log('App became visible, checking connection status...');
      
      // Request wake lock when app becomes visible during game
      if (gameState === 'game') {
        requestWakeLock();
      }
      
      // ✅ REMOVED: Client-side stealth disconnect detection
      // Server now handles this automatically when player reconnects from formerPlayers state
      
      if (!socket.connected) {
        console.log('Reconnecting after visibility change...');
        socket.connect();
        
        // Give it a moment to connect then request game state
        setTimeout(() => {
          if (gameState === 'game') {
            socket.emit('requestGameState', { roomCode, playerName });
          }
        }, 1000);
      }
    } else {
      // App going to background - prepare for potential disconnect
      console.log('App going to background, saving state...');
      if (gameState === 'game') {
        saveGameStateLocally();
      }
    }
  };

  // Enhanced mobile focus handling
  const handleAppFocus = () => {
    console.log('Window focus gained, checking connection...');
    
    if (gameState === 'game') {
      requestWakeLock();
    }
    
    // ✅ REMOVED: Client-side stealth disconnect detection
    // Server now handles this automatically when player reconnects from formerPlayers state
    
    if (!socket.connected) {
      socket.connect();
      
      // Give connection time to establish
      setTimeout(() => {
        if (gameState === 'game') {
          socket.emit('requestGameState', { roomCode, playerName });
        }
      }, 1000);
    }
  };

  const handleAppBlur = () => {
    console.log('Window lost focus');
    if (gameState === 'game') {
      saveGameStateLocally();
    }
  };

  // Mobile-specific touch events to maintain wake lock
  const handleTouchStart = () => {
    if (gameState === 'game' && !wakeLock) {
      requestWakeLock();
    }
  };

  // Request wake lock when entering game
  if (gameState === 'game') {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleAppFocus);
  window.addEventListener('blur', handleAppBlur);
  document.addEventListener('touchstart', handleTouchStart);
  
  // Clean up event listeners and wake lock when component unmounts
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleAppFocus);
    window.removeEventListener('blur', handleAppBlur);
    document.removeEventListener('touchstart', handleTouchStart);
    releaseWakeLock();
  };
}, [socket, gameState, roomCode]);

/*
useEffect(() => {
  // Set zoom to 70% when the page loads
  window.onload = function() {
  };
}, []);
*/
// Listen for the quarterUpdated event from the server
useEffect(() => {
  socket.on('quarterUpdated', (updatedQuarter) => {
    setQuarter(updatedQuarter);
    console.log(`Quarter updated to: ${updatedQuarter}`);
    // A fresh break is a fresh selection: carrying last quarter's picks over
    // would pre-select cards the player has not looked at.
    setSwapSelection({});
    if (updatedQuarter > 1) {
      openWildCardSelection();
    }
  });

  return () => {
    socket.off('quarterUpdated');
  };
}, []);

// ✅ DEBUG: Add universal event listener to catch ALL socket events
useEffect(() => {
  const originalOn = socket.on.bind(socket);
  const originalEmit = socket.emit.bind(socket);
  
  // Override socket.on to log all event registrations
  socket.on = function(event, handler) {
    console.log(`🔧 DEBUG: Registering event handler for: ${event}`);
    return originalOn(event, handler);
  };
  
  // Override socket.emit to log all outgoing events
  socket.emit = function(event, ...args) {
    console.log(`📤 DEBUG: Emitting event: ${event}`, args);
    return originalEmit(event, ...args);
  };
  
  // Listen for ALL incoming events
  const originalOnevent = socket.onevent;
  socket.onevent = function(packet) {
    console.log(`📥 DEBUG: Received socket event: ${packet.data[0]}`, packet.data.slice(1));
    return originalOnevent.call(this, packet);
  };
  
  return () => {
    socket.on = originalOn;
    socket.emit = originalEmit;
    socket.onevent = originalOnevent;
  };
}, []);

// Add this to your App.js, replacing your current socket event listeners
useEffect(() => {
  // Connection events
  const handleConnect = () => {
    console.log('🔌 DEBUG: Connected to server:', socket.id);
    console.log('🔌 DEBUG: Game state on connect:', gameState);
    console.log('🔌 DEBUG: Room code on connect:', roomCode);
    console.log('🔌 DEBUG: Player name on connect:', playerName);
    
    // If we're in a game, request the current state
    if (gameState === 'game' && roomCode) {
      socket.emit('requestGameState', { roomCode, playerName });
    }
  };
  
  const handleDisconnect = (reason) => {
    console.log('Disconnected from server. Reason:', reason);
    
    // Only attempt to reconnect if it's a transport close and not an intentional disconnect
    if (reason === 'transport close' || reason === 'ping timeout') {
      console.log('Will attempt to reconnect automatically...');
    }
  };
  
  const handleReconnectAttempt = (attemptNumber) => {
    console.log(`Reconnection attempt #${attemptNumber}`);
  };
  
  const handleReconnect = (attemptNumber) => {
    console.log(`Successfully reconnected after ${attemptNumber} attempt(s)`);
    
    // Enhanced reconnection logic for mobile
    if (gameState === 'game' && roomCode) {
      // Wait a moment for the connection to stabilize
      setTimeout(() => {
        console.log('Requesting game state after successful reconnection');
        socket.emit('requestGameState', { roomCode, playerName });
        
        // Try to recover from local storage as immediate fallback while waiting for refresh
        const localState = loadGameStateLocally();
        if (localState) {
          console.log('Loaded game state from local storage while waiting for server response');
          // Update UI elements that don't depend on fresh server data
          setQuarter(localState.quarter);
          
          // Restore basic player info if available
          if (localState.players && localState.players.length > 0) {
            const currentPlayer = localState.players.find(p => p.name === playerName);
            if (currentPlayer && currentPlayer.cards) {
              console.log('Restoring player hand from local storage');
              setPlayers(prevPlayers =>
                prevPlayers.map(player =>
                  player.name === playerName 
                    ? { ...player, cards: currentPlayer.cards }
                    : player
                )
              );
            }
          }
          
          // Restore player stats if available
          if (localState.playerStats) {
            setPlayerStats(localState.playerStats);
          }
        }
      }, 500);
    }
  };
  
  const handleReconnectError = (error) => {
    console.error('Reconnection error:', error);
  };
  
  const handleReconnectFailed = () => {
    console.log('Failed to reconnect after all attempts');
    
    // Try to restore from local storage as last resort
    const localState = loadGameStateLocally();
    if (localState && gameState === 'game') {
      console.log('Using local storage as fallback after reconnection failure');
      announce(
        'Connection lost',
        'You are on a saved copy of the game. Scores and cards may be out of date until you reconnect.',
      );
      
      // Restore what we can from local storage
      if (localState.players && localState.players.length > 0) {
        setPlayers(localState.players);
      }
      if (localState.playerStats) {
        setPlayerStats(localState.playerStats);
      }
      setQuarter(localState.quarter);
    } else {
      announce('Could not reconnect', 'Refresh the page to get back into the game.');
    }
  };
  
  const handleError = (error) => {
    console.error('Socket error:', error);
  };
  
  // ✅ NEW: Handle forceRefresh command from server
  const handleForceRefresh = ({ reason, playerName }) => {
    console.log(`🔄 Server requested force refresh for ${playerName}: ${reason}`);
    console.log('🔄 EXECUTING HARD REFRESH like physical button press...');
    
    // ✅ FIX: Force hard refresh like physical button press on mobile
    try {
      // Method 1: Force reload with cache bypass (like Ctrl+F5)
      window.location.reload(true);
    } catch (e) {
      try {
        // Method 2: Replace current location to force refresh
        window.location.replace(window.location.href);
      } catch (e2) {
        try {
          // Method 3: Set href to current location
          window.location.href = window.location.href;
        } catch (e3) {
          // Method 4: Last resort - navigate to same URL
          window.location = window.location;
        }
      }
    }
  };

  // Add event listeners
  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('reconnect_attempt', handleReconnectAttempt);
  socket.on('reconnect', handleReconnect);
  socket.on('reconnect_error', handleReconnectError);
  socket.on('reconnect_failed', handleReconnectFailed);
  socket.on('error', handleError);
  socket.on('forceRefresh', handleForceRefresh);
  
  // Clean up listeners
  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('reconnect_attempt', handleReconnectAttempt);
    socket.off('reconnect', handleReconnect);
    socket.off('reconnect_error', handleReconnectError);
    socket.off('reconnect_failed', handleReconnectFailed);
    socket.off('error', handleError);
    socket.off('forceRefresh', handleForceRefresh);
  };
}, [socket, gameState, roomCode]);


  // Listen for the wild card selection from the server
  useEffect(() => {
    socket.on('wildCardSelected', ({ playerId, wildcardtype }) => {
      console.log(`🎯 Host received wild card selection: ${wildcardtype} by player: ${playerId}`);
      console.log(`🎯 Setting wild card modal state, isHost: ${isHost}`);
      setWildCardSelected({ player: playerId, wildcardtype });
    });

    return () => {
      socket.off('wildCardSelected');
    };
  }, [isHost]);

// Listen for messages from the server
useEffect(() => {
  socket.on('actionInProgress', (message) => {
    // This one fires WHILE a round is running, by definition — it is the
    // server saying "a round is already in progress". Freezing the main
    // thread here stopped the very countdown the message is about.
    announce('Hold on', message);
    console.log("set action message", message);
  });

  socket.on('roundEnded', (message) => {
    setActionMessage('');  // Clear the message when the round ends
    console.log("clear action message", message);

  });

  return () => {
    socket.off('actionInProgress');
    socket.off('roundEnded');
  };
}, []);

useEffect(() => {
  socket.on('noCard', (message) => {
    if (message) {
      setNoCardMessage(true);
      setTimeout(() => setNoCardMessage(false), 5000);  // Clear message after 5 seconds
    }
  });

  return () => {
    socket.off('noCard');
  };
}, []);

/**
 * Pours reach the server as they happen.
 *
 * This used to hold every assignment in local state for the whole round and
 * emit one batch when the timer hit zero. Anything the player had tapped was
 * therefore lost if they refreshed, backgrounded the app long enough to be
 * dropped, or closed the tab — the taps had never left the phone.
 *
 * Now the pending buffer is flushed on a short interval, so no tap is at risk
 * for longer than POUR_FLUSH_MS, and it is flushed again on unload and when the
 * round ends. Lock In is an optional early commit, never a requirement.
 */
useEffect(() => {
  if (timeRemaining <= 0) return undefined;
  const id = setInterval(flushPours, POUR_FLUSH_MS);
  return () => clearInterval(id);
}, [timeRemaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

// A refresh must not cost you the last tap.
useEffect(() => {
  const onUnload = () => flushPours();
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('pagehide', onUnload);
  return () => {
    window.removeEventListener('beforeunload', onUnload);
    window.removeEventListener('pagehide', onUnload);
  };
}, []); // eslint-disable-line react-hooks/exhaustive-deps

// The round ended. Whatever was poured counts; nothing needed confirming.
useEffect(() => {
  if (timeRemaining !== 0) return;
  flushPours();
  if (pourStack.length > 0 && !pourSent) {
    setPourSent(true);
    showToast(`Time! ${pourStack.length} pour${pourStack.length === 1 ? '' : 's'} locked in automatically`);
  }
}, [timeRemaining]); // eslint-disable-line react-hooks/exhaustive-deps

// A new round is a clean slate.
useEffect(() => {
  if (!declaredCard) return;
  localPoursRef.current = { drinks: {}, shotguns: {} };
  sentPoursRef.current = { drinks: {}, shotguns: {} };
  setAssignedDrinks({ drinks: {}, shotguns: {} });
  setPourStack([]);
  setPourSent(false);
  setTileAnim({});
}, [declaredCard]);

// Listen for the timer updates from the server
useEffect(() => {
  socket.on('updateTimer', (remainingTime) => {
    setTimeRemaining(remainingTime);
  });

  // ✅ The server has emitted `roundState` on reconnect since the first audit
  // and nothing has ever listened for it, which is why the timer was wrong
  // after a mid-round refresh. It carries the ACTUAL time left, measured
  // against the real round length.
  socket.on('roundState', ({ timeRemaining: left, roundInProgress, declaredCard: card }) => {
    console.log('🕒 roundState on reconnect:', { left, roundInProgress, card });
    if (!roundInProgress) return;
    if (card) setDeclaredCard(card);
    if (typeof left === 'number' && left > 0) setTimeRemaining(left);
  });

  // Listen for the updated player stats and round results after the timer ends
  socket.on('updatePlayerStats', ({ players, roundResults, roundFinalized }) => {
    // ✅ SIMPLIFIED: Use backend player names directly - no guessing
    if (players) {
      console.log(`🎯 BACKEND DATA: Processing ${Object.keys(players).length} players from backend`);
      console.log(`🎯 BACKEND DATA: Raw players object:`, Object.entries(players).map(([id, data]) => ({ 
        id: id.slice(-4), 
        name: data.name || 'NO_NAME', 
        totalDrinks: data.totalDrinks,
        disconnected: data.disconnected 
      })));
      
      const newNameMap = { ...playerNameMap }; // PRESERVE existing mappings
      
      // Update with backend names where provided, keep existing otherwise
      Object.keys(players).forEach(backendId => {
        const backendPlayer = players[backendId];
        
        if (backendPlayer.name) {
          newNameMap[backendId] = backendPlayer.name;
          console.log(`✅ BACKEND NAME: ${backendId.slice(-4)} -> "${backendPlayer.name}"`);
        } else {
          // Keep existing mapping if we have one
          if (newNameMap[backendId]) {
            console.log(`🔄 PRESERVED: ${backendId.slice(-4)} -> "${newNameMap[backendId]}" (backend didn't send name)`);
          } else {
            console.log(`⚠️ MISSING NAME: Backend player ${backendId.slice(-4)} has no name and no existing mapping`);
          }
        }
      });
      
      setPlayerNameMap(newNameMap);
      console.log("📝 BACKEND NAME MAPPINGS:", Object.entries(newNameMap).map(([id, name]) => `${name}(${id.slice(-4)})`));
    }
    
    // ✅ SIMPLE: Use backend as single source of truth for player stats
    if (players) {
      console.log(`📊 BACKEND DATA: Received ${Object.keys(players).length} player entries from backend`);
      console.log(`📊 BACKEND PLAYERS:`, Object.entries(players).map(([id, stats]) => `${stats.name || 'UNNAMED'}(${id.slice(-4)}): ${stats.totalDrinks} drinks`));
      
      setPlayerStats(prevStats => {
        const updatedStats = {};
        
        console.log(`🎯 USING BACKEND NAMES: Processing ${Object.keys(players).length} players with backend names`);
        
        // Process each player from backend - includes both active AND disconnected players
        Object.keys(players).forEach(playerId => {
          const backendStats = players[playerId];
          
          // Include disconnected players to show their current stats while away
          if (backendStats.disconnected) {
            console.log(`📱 DISCONNECTED: Player ${backendStats.name || 'UNNAMED'} (${playerId.slice(-4)}) -> ${backendStats.totalDrinks} drinks (offline)`);
          }
          
          // Use backend name directly - no guessing needed!
          if (backendStats.name) {
            updatedStats[playerId] = {
              ...backendStats,
              name: backendStats.name
            };
            const status = backendStats.disconnected ? 'offline' : 'online';
            console.log(`✅ BACKEND NAME: ${backendStats.name} (${playerId.slice(-4)}) -> ${backendStats.totalDrinks} drinks (${status})`);
          } else {
            console.log(`⚠️ NO BACKEND NAME: Player ${playerId.slice(-4)} has no name from backend`);
          }
        });
        
        console.log(`🎯 FINAL STATS: ${Object.keys(updatedStats).length} players with backend names`);
        console.log(`🎯 FINAL MAPPINGS:`, Object.entries(updatedStats).map(([id, stats]) => `${stats.name}(${id.slice(-4)}): ${stats.totalDrinks} drinks`));
        
        // Update playersRef to reflect current backend mappings
        setTimeout(() => {
          setPlayers(prevPlayers => {
            const updatedPlayers = [...prevPlayers];
            
            // Update player IDs based on backend data
            Object.entries(updatedStats).forEach(([currentId, stats]) => {
              const playerIndex = updatedPlayers.findIndex(p => p.name === stats.name);
              if (playerIndex !== -1 && updatedPlayers[playerIndex].id !== currentId) {
                console.log(`🔄 UPDATING PLAYERS REF: ${stats.name} (${updatedPlayers[playerIndex].id.slice(-4)} -> ${currentId.slice(-4)})`);
                updatedPlayers[playerIndex] = { ...updatedPlayers[playerIndex], id: currentId };
              }
            });
            
            return updatedPlayers;
          });
        }, 0);
        
        return updatedStats;
      });
    }
    
    setRoundDrinkResults(roundResults);  // Update the round results
    console.log("Round drink results (for all players):", roundResults);

    // ✅ FIX: Only reset drink assignment state if round is officially finalized
    // 🛡️ ULTRA PROTECTION: Never reset during active drink distribution
    if (roundFinalized === true) {
      // Distinctly different from the start: higher, softer, falling.
      playRoundEnd({ enabled: soundOnRef.current });
      if (flasherRef.current) flasherRef.current.stop();
      // The board flips itself to Round Results the moment a round lands --
      // that is when everyone looks at their phone. Standings is one tap back.
      setLastRoundCard(declaredCardRef.current || null);
      setLastRoundRows(buildRoundRows(roundResults, playersRef.current));
      setBoardTab('last');
      setBoardPulse(true);
      setBoardPinned(false); // an automatic flip, so the idle timer may undo it
      setTimeout(() => setBoardPulse(false), 1200);
    }

    if (roundFinalized === true && !isDistributingRef.current) {  
      console.log("🔄 Round officially finalized - resetting drink assignment state");
      // Reset drink assignment state when the round is finalized
      setDrinkMessage('');  // Clear the drink assignment message
      setAssignedDrinks({});  // Clear the assigned drinks
      setDrinksToGive(0);  // Reset the drinks to give
      setIsDistributing(false);  // Turn off drink distribution mode
      setHasMatchingCardForCurrentEvent(false);  // Clear matching card flag
    } else {
      console.log("📊 Player stats updated (player join/leave/reconnect) - preserving drink assignment state");
      console.log("🔧 DEBUG: roundFinalized value:", roundFinalized, "type:", typeof roundFinalized);
      if (isDistributingRef.current) {
        console.log("🛡️ ULTRA PROTECTION: Active drink distribution detected - blocking any state reset");
      }
    }

  });

  return () => {
    socket.off('updateTimer');
    socket.off('updatePlayerStats');
  };
}, []);

useEffect(() => {
  // Listen for the declared card from the server
  socket.on('declaredCard', (cardType) => {
    // A round is starting. Buzz, vibrate, and flash the tab if they are away.
    // `cardType` is also broadcast as null to CLEAR a round, so only a real
    // card counts as a start.
    if (cardType) {
      playRoundStart({ enabled: soundOnRef.current });
      vibrate();
      if (flasherRef.current) flasherRef.current.start('🏈 Round started!');
    }
    console.log('New card declared:', cardType);
    setDeclaredCard(cardType);  // Update the state with the declared card
    // `declaredCard: null` is the finalize reset. Drop the attribution with it,
    // so last round's "the game called it" cannot sit over the Ref's next call.
    if (!cardType) setRoundSource(null);
    
    // ✅ CRITICAL FIX: Reset hasMatchingCardForCurrentEvent when new card is declared
    // This ensures that only players with the NEW card can distribute drinks
    setHasMatchingCardForCurrentEvent(false);
    
    // ✅ ADDITIONAL FIX: Clear distribution state to prevent continuing drinks from previous round
    setIsDistributing(false);
    setDrinkMessage('');
    setDrinksToGive(0);
    setshotgunsToGive(0);
    
    console.log('🔧 CARD RESET: Cleared all distribution state for new card declaration:', cardType);
  });

  // Cleanup the listener when the component unmounts
  return () => {
    socket.off('declaredCard');  // Remove the event listener not sure this is even doing anything to be honest
    console.log('Declared card socet off');

  };
}, []);
// UseEffect to listen for first down message
useEffect(() => {
  socket.on('firstDownMessage', (message) => {
    setDrinkMessage(message);  // Set the message for the first down event
    console.log(message);  // Log the message
  });

  return () => {
    socket.off('firstDownMessage');
  };
}, []);


useEffect(() => {
  socket.on('updatePlayerHand', ({ standard, wild }) => {
    setPlayers(prevPlayers =>
      prevPlayers.map(player =>
        player.id === socket.id ? { ...player, cards: { standard, wild } } : player
      )
    );
    console.log("Player hand updated:", { standard, wild });  // Log the updated hand
    
    // NO AUTO-REFRESH HERE - only refresh on initial connection with URL params
    // Removed refresh logic to prevent mass refreshing of all players
  });

  return () => {
    socket.off('updatePlayerHand');
  };
}, []);

// Separate useEffect for room events that doesn't depend on players array
useEffect(() => {
  const handleRoomCreated = (newRoomCode) => {
    // Only the creator is sent this event, so it IS the server naming the host.
    setHostId(socket.id);
    setRoomCode(newRoomCode);
    setGameState('lobby');
    
    // Update URL immediately when room is created
    if (playerName) {
      updateURL(newRoomCode, playerName);
    }
  };

  socket.on('roomCreated', handleRoomCreated);
  
  return () => {
    socket.off('roomCreated', handleRoomCreated);
  };
}, [playerName]); // Depend on playerName instead of players

  useEffect(() => {
    // Debug: Log ALL socket events
    const originalEmit = socket.emit;
    const originalOn = socket.on;
    
    // Override socket.on to log all incoming events
    socket.onAny((eventName, ...args) => {
      console.log('📡 SOCKET EVENT RECEIVED:', eventName, args);
    });
    
    socket.on('joinedRoom', (joinedRoomCode) => {
      console.log('🏠 JOINED ROOM EVENT RECEIVED:', joinedRoomCode);
      console.log('🎯 Current gameState before update:', gameState);
      
      setRoomCode(joinedRoomCode);
      updateURL(joinedRoomCode, playerName); // Store in URL
      setGameState('lobby');
      console.log('🎯 Setting gameState to: lobby');
        
      // Rules on joining, same as on starting a game.
      announce('How to play', instructionsmessage);
      
      console.log('✅ Lobby state updated successfully');
    });

    socket.on('updatePlayers', (playersList) => {
      console.log('👥 DEBUG: Received updatePlayers event with:', playersList);
      console.log('👥 DEBUG: Current players before update:', playersRef.current);
      
      // ✅ CAPTURE NAMES: Store player names when they join/reconnect
      const newNameMappings = {};
      playersList.forEach(player => {
        if (player.id && player.name) {
          newNameMappings[player.id] = player.name;
        }
      });
      
      if (Object.keys(newNameMappings).length > 0) {
        setPlayerNameMap(prev => {
          const updated = { ...prev, ...newNameMappings };
          console.log('🎯 CAPTURED NAMES from updatePlayers:', Object.entries(newNameMappings).map(([id, name]) => `${name}(${id.slice(-4)})`));
          console.log('🎯 TOTAL NAME MAPPINGS:', Object.entries(updated).map(([id, name]) => `${name}(${id.slice(-4)})`));
          return updated;
        });
      }
      
      // 🛡️ SELECTIVE PROTECTION: Allow player updates but preserve distributing player's cards
      if (isDistributingRef.current) {
        console.log('🛡️ SELECTIVE PROTECTION: Player update during drink distribution - preserving current player cards');
      }

      // ⚠️ playersRef.current, NOT `players`. This handler is registered in a
      // useEffect with [] deps, so the `players` it closes over is frozen at
      // the first render — an empty array, forever. Reading it meant the
      // card-preservation lookup never matched anyone, so every roster
      // broadcast stripped the hands off the WHOLE TABLE until finalizeRound
      // re-sent them. That is Session 8 item 2. Do not "simplify" this back.
      const pending = window.pendingPlayerCards || {};
      const merged = mergePlayerCards(playersList, playersRef.current, pending);
      consumedPendingIds(playersList, playersRef.current, pending).forEach((id) => {
        delete window.pendingPlayerCards[id];
      });

      console.log(`👥 DEBUG: roster ${playersList.length} in, ${merged.length} after merge; `
        + `hands kept for ${merged.filter((p) => p.cards).length}`);
      setPlayers(merged);
    });

    socket.on('gameStarted', ({ hands, playerStats, hostId: incomingHostId }) => {
      // Reconnects and mid-game joins learn the Ref from here; there may be no
      // `newHost` to follow, so this is the only chance to get it right.
      if (incomingHostId) setHostId(incomingHostId);
      console.log('🎮 GAME STARTED EVENT RECEIVED:', { hands, playerStats });
      console.log('🔌 DEBUG: Current socket ID when receiving gameStarted:', socket.id);
      console.log('🔌 DEBUG: Available hands for socket IDs:', Object.keys(hands));
      console.log('🔌 DEBUG: Socket ID match check:', hands.hasOwnProperty(socket.id));
      console.log('🎯 Current gameState before update:', gameState);
      console.log('🎯 Current players before update:', players);
      console.log('🎯 My hand data:', hands[socket.id]);
      console.log('🔍 DEBUG: hands object structure:', hands);
      console.log('🔍 DEBUG: My hand standard cards:', hands[socket.id]?.standard);
      console.log('🔍 DEBUG: My hand wild cards:', hands[socket.id]?.wild);
      
      // Validate hands data
      if (!hands || !hands[socket.id]) {
        console.error('❌ INVALID HANDS DATA:', hands);
        console.error('❌ Socket ID not found in hands:', socket.id);
        return;
      }
      
      // ✅ FIX: Handle empty players array on reconnection  
      console.log('🔧 DEBUG: Processing players array for card assignment');
      console.log('🔧 DEBUG: Current players array length:', players.length);
      console.log('🔧 DEBUG: Available hands for socket IDs:', Object.keys(hands));
      
      if (playersRef.current.length === 0) {
        console.log('🔧 DEBUG: Players ref is empty - will wait for updatePlayers to create proper entry');
        // ✅ FIX: Store cards in temporary state for updatePlayers to use
        window.pendingPlayerCards = {
          [socket.id]: hands[socket.id]
        };
        console.log('🎯 Stored cards for upcoming updatePlayers event');
      } else {
        console.log('🔧 DEBUG: Updating existing players array with cards');
        
        // 🛡️ SELECTIVE PROTECTION: Allow gameStarted updates but preserve distributing player state
        if (isDistributingRef.current) {
          console.log('🛡️ SELECTIVE PROTECTION: gameStarted during drink distribution - maintaining assignment state');
          console.log('🛡️ REASON: Allowing game updates while protecting drink assignment');
        }
        
        // Always process gameStarted updates (with card preservation already built-in)
        setPlayers(playersRef.current.map(player => ({
          ...player,
          cards: hands[player.id]
        })));
      }
      
      // Set player stats to show the initial scoreboard
      setPlayerStats(playerStats);
    
      setGameState('game');
      console.log('🎯 Setting gameState to: game');
      
      // Ensure URL is updated for all players (including host) when game starts
      updateURL(roomCode, playerName);
      
       // Adjust the page zoom when the game starts
        
      console.log('✅ Game state updated successfully');
      console.log('✅ Final gameState:', gameState);
      console.log('✅ Final players:', players);
    });

    socket.on('distributeDrinks', (payload) => {
      // Trust the server. This event is sent with io.to(player.id), so it only
      // reaches players who actually owe something.
      //
      // The old handler re-checked that the player's CURRENT HAND still held
      // the declared card, and cleared the distribution state when it did not.
      // That check can never pass after a reconnect: the server removes a
      // played card and deals a replacement the instant it is played, so the
      // hand no longer holds it by design. On a refresh the roster is empty
      // too, because the replay arrives before gameStarted. The result was a
      // player who rejoined mid-round and could not pour -- Session 8 item 3,
      // and the reason the Phase 7a server fix looked right on the wire but
      // still failed on a phone.
      const prompt = readPourPrompt(payload);
      console.log('🍺 DISTRIBUTE DRINKS:', payload, '->', prompt);

      if (!prompt) {
        // Nothing owed. Only stand down if nobody else is mid-distribution.
        if (!isDistributingRef.current) {
          setDrinkMessage('');
          setIsDistributing(false);
        }
        setHasMatchingCardForCurrentEvent(false);
        return;
      }

      setDeclaredCard(prompt.card);
      setDrinkMessage(prompt.message);
      setDrinksToGive(prompt.drinks);
      setshotgunsToGive(prompt.shotguns);
      setIsDistributing(true);
      setHasMatchingCardForCurrentEvent(true);
      setAssignedDrinks({ drinks: {}, shotguns: {} });
    });

    // ✅ REMOVED: Duplicate updatePlayerStats handler #2 to fix duplicate entries issue

    socket.on('error', (msg) => {
      setErrorMessage(msg);
    });


    // Handle when a new host is assigned
    socket.on('newHost', ({ newHostId, message }) => {
      setHostId(newHostId);  // isHost is derived from this
      // Was `alert(message)`. The popup stays and still needs a tap; what
      // changed is that the round underneath keeps running while it is up.
      // This fires mid-round by definition — the usual reason the whistle
      // moves is that somebody's phone just died — so freezing the main
      // thread here cost people the rest of the round.
      announce('The whistle moved', message);
    });

    // Handle when a player disconnects during the game
    socket.on('playerDisconnected', ({ playerId, playerName, remainingPlayers, allPlayers }) => {
      // 🛡️ SELECTIVE PROTECTION: Allow disconnect updates but preserve distributing player state
      if (isDistributingRef.current) {
        console.log('🛡️ SELECTIVE PROTECTION: Player disconnect during drink distribution - maintaining assignment state');
        console.log('🛡️ REASON: Allowing disconnect updates while protecting drink assignment');
      }
      
      // ✅ FIX: Use card preservation logic for disconnect updates too
      const preservedPlayers = allPlayers.map(serverPlayer => {
        const existingPlayer = playersRef.current.find(p => p.id === serverPlayer.id);
        if (existingPlayer && existingPlayer.cards) {
          return {
            ...serverPlayer,
            cards: existingPlayer.cards  // Preserve existing cards
          };
        }
        return serverPlayer;
      });
      setPlayers(preservedPlayers);
      console.log(`Player ${playerName} disconnected`);
    });

    // Handle when a player reconnects during the game
    socket.on('playerReconnected', ({ playerId, playerName: reconnectedPlayerName, allPlayers }) => {
      console.log(`Player ${reconnectedPlayerName} reconnected`);
      
      // 🛡️ SELECTIVE PROTECTION: Allow reconnection updates but preserve distributing player state
      if (isDistributingRef.current) {
        console.log('🛡️ SELECTIVE PROTECTION: Player reconnection during drink distribution - maintaining assignment state');
        console.log('🛡️ REASON: Allowing reconnection updates while protecting drink assignment');
      }
      
      // ✅ FIX: Use card preservation logic for reconnection updates too  
      const preservedPlayers = allPlayers.map(serverPlayer => {
        const existingPlayer = playersRef.current.find(p => p.id === serverPlayer.id);
        if (existingPlayer && existingPlayer.cards) {
          return {
            ...serverPlayer,
            cards: existingPlayer.cards  // Preserve existing cards
          };
        }
        return serverPlayer;
      });
      setPlayers(preservedPlayers);
      
      // Force a UI update to prevent white screen
      setTimeout(() => {
        setPlayers(prevPlayers => [...prevPlayers]);
      }, 100);
      
      // No auto-refresh here - let the personal refresh signal handle this
    });

    // Handle playerRejoined events (protect from state corruption)
    socket.on('playerRejoined', ({ playerId, playerName }) => {
      // 🛡️ PROTECTION: Ignore playerRejoined events during drink distribution
      if (isDistributingRef.current) {
        console.log('🛡️ PROTECTED: Ignoring playerRejoined event while distributing drinks');
        console.log(`🛡️ REASON: ${playerName} rejoined but not updating UI to prevent corruption`);
        return;
      }
      
      console.log(`👥 Player ${playerName} rejoined the game`);
      
      // ✅ ENHANCED: Update name mapping for reconnected player
      if (playerId && playerName) {
        setPlayerNameMap(prev => ({
          ...prev,
          [playerId]: playerName
        }));
        console.log(`📝 Updated name mapping for reconnected player: ${playerId} -> ${playerName}`);
      }
      // Note: No setPlayers() call needed here - updatePlayers handles the actual list updates
    });

    // Listen for player stats updates (specifically for reconnections)
    // ✅ REMOVED: Duplicate updatePlayerStats handler #3 to fix duplicate entries issue

    // ✅ REMOVED triggerPersonalRefresh handler - gameStarted already handles reconnection perfectly
    console.log(`🎯 Reconnection handling simplified - gameStarted event provides all necessary data`);

// Handle when a player leaves during the game (old event, kept for compatibility)
socket.on('playerLeft', ({ playerId, remainingPlayers }) => {
  setPlayers(remainingPlayers);  // Update the player list with remaining players
  // Optionally remove player icon from the game UI
});


// Handle when the game is over due to all players disconnecting
// ── Live game tracking: what the server tells us ──────────────────────────
//
// Every one of these is inert until the Ref attaches a game. `playAutoCalled`
// is NOT a declaration — Part A deliberately calls nothing. It is the feed of
// what the system WOULD have called, with the 45s broadcast delay already
// applied server-side, which is what makes the pacing judgeable by watching.
// The Ref removed this player. Their socket is still connected and still in
// the room's channel when this arrives, so the screen must move itself back to
// the start rather than sit on a game they are no longer part of.
// The quarter break, as a room-level phase rather than a modal each client
// opens for itself. The server holds `isActionInProgress` for its duration, so
// nothing can start a round mid-break; this is only so the table can SEE it.
// The returning-player announcement. Validated here as well as on the server,
// because this is the one string in the app that arrives from outside config
// and is shown to everyone. Anything not fully understood renders nothing.
socket.off('announcement');
socket.on('announcement', (payload) => {
  const parsed = parseAnnouncement(payload);
  if (parsed && !isDismissed(parsed.id)) setBanner(parsed);
});
// Ask, rather than relying on the server's emit-on-connect: `io()` runs at
// module load, so the socket is often already connected by the time this
// handler is registered and that emit would have gone to nobody.
if (socket.connected) socket.emit('requestAnnouncement');
else socket.once('connect', () => socket.emit('requestAnnouncement'));

socket.off('quarterBreak');
socket.on('quarterBreak', ({ open } = {}) => {
  setBreakOpen(Boolean(open));
  if (!open) {
    // The break closed underneath us — timed out, or everyone else answered.
    // Do not leave a sheet open over a game that has resumed.
    setIsWildCardSelectionOpen(false);
    setSwapSelection({});
  }
});

// The Ref tried to turn the quarter over mid-round without insisting.
socket.off('quarterBlocked');
socket.on('quarterBlocked', ({ reason } = {}) => {
  setQuarterWarning([reason || 'A round is running.']);
});

socket.off('removedFromGame');
socket.on('removedFromGame', ({ message } = {}) => {
  forgetSavedGame();
  clearURL();
  setRoomCode('');
  setPlayers([]);
  setHostId(null);
  setDeclaredCard('');
  setWatching(null);
  setErrorMessage(message || 'The Ref removed you from the game.');
  setGameState('initial');
});

socket.off('gameList');
socket.on('gameList', ({ league, games, error }) => {
  setGameListLoading(false);
  setGameListError(error || null);
  setGameList(Array.isArray(games) ? games : []);
  if (league) setPickerLeague(league);
});

socket.off('gameAttached');
socket.on('gameAttached', (payload) => {
  setWatching({ ...payload, error: null, ended: false });
  setCallEntries([]);
  setCardModes(payload.cardModes || {});
  setCardDefaults(payload.cardDefaults || {});
  setAutoCallPaused(Boolean(payload.autoCallPaused));
  // Said once, plainly: people should not have to work out why rounds are
  // starting on their own.
  if (payload.announce) setFeedNotice(payload.announce);
});

socket.off('gameDetached');
socket.on('gameDetached', () => {
  setWatching(null);
});

socket.off('gameFeedUpdate');
socket.on('gameFeedUpdate', (payload) => {
  setWatching((prev) => (prev ? { ...prev, ...payload, error: null } : prev));
});

socket.off('gameFeedEnded');
socket.on('gameFeedEnded', ({ reason } = {}) => {
  // Say so rather than freezing on a stale score.
  setWatching((prev) => (prev ? { ...prev, ended: true, endedReason: reason || null } : prev));
});

socket.off('playAutoCalled');
socket.on('playAutoCalled', ({ cardId, reason, playId } = {}) => {
  if (!cardId) return;
  callSeq += 1;
  setCallEntries((prev) => [
    { key: `${playId || 'x'}-${cardId}-${callSeq}`, cardId, reason: reason || '', at: clockNow(), suggestion: false },
    ...prev,
  ].slice(0, 100));
});

socket.off('playSuggested');
socket.on('playSuggested', ({ cardId, reason, playId } = {}) => {
  if (!cardId) return;
  callSeq += 1;
  setCallEntries((prev) => [
    { key: `${playId || 'x'}-${cardId}-s${callSeq}`, cardId, reason: reason || '', at: clockNow(), suggestion: true },
    ...prev,
  ].slice(0, 100));
  // Queue it. Same play suggested twice is one question, not two.
  setSuggestions((prev) => {
    if (prev.some((x) => x.cardId === cardId && x.playId === playId)) return prev;
    const next = [...prev, { cardId, reason: reason || '', playId }];
    return next.length > MAX_PENDING_SUGGESTIONS
      ? next.slice(next.length - MAX_PENDING_SUGGESTIONS)
      : next;
  });
});

socket.off('roundSource');
socket.on('roundSource', (payload) => setRoundSource(payload || null));

socket.off('cardModes');
socket.on('cardModes', ({ cardModes: modes } = {}) => setCardModes(modes || {}));

socket.off('autoCallPaused');
socket.on('autoCallPaused', ({ paused } = {}) => setAutoCallPaused(Boolean(paused)));

socket.off('playSkipped');
socket.on('playSkipped', ({ cardId, reason } = {}) => {
  if (!cardId) return;
  callSeq += 1;
  setCallEntries((prev) => [
    { key: `skip-${cardId}-${callSeq}`, cardId, reason: `not called — ${reason}`,
      at: clockNow(), suggestion: false, skipped: true },
    ...prev,
  ].slice(0, 100));
});

/**
 * The game finished on purpose. Everyone lands on the curtain call.
 *
 * `gameOver` (below) stays exactly as it was — it is an ABANDONMENT path, not
 * a result, and dropping someone on a scoreboard because the room emptied
 * would be claiming a finish that did not happen.
 */
socket.off('gameEnded');
socket.on('gameEnded', ({ standings } = {}) => {
  setFinalStandings(Array.isArray(standings) ? standings : []);
  setGameState('over');
  forgetSavedGame();   // it is over; do not try to rejoin it on the next load
});

socket.off('returnedToLobby');
socket.on('returnedToLobby', ({ players: roster } = {}) => {
  setFinalStandings(null);
  if (Array.isArray(roster)) setPlayers(roster);
  setDeclaredCard('');
  setGameState('lobby');
});

socket.off('gameOver');
socket.on('gameOver', (message) => {
  announce('Game over', message);
  // Redirect everyone back to the main screen
  setGameState('initial');
  forgetSavedGame();  // the game is over; do not rejoin it on the next load
  clearURL();  // Clear URL when game ends so they can join new games
});



    // NOTE: there is no `hostLeft` listener any more, and the server no longer
    // emits one. The host leaving does not close the room — the whistle moves
    // and everyone keeps their seat. See tests/room-lifecycle.test.js.

    return () => {
      socket.off('joinedRoom');
      socket.off('updatePlayers');
      socket.off('gameStarted');
      socket.off('distributeDrinks');
      socket.off('updatePlayerStats');
      socket.off('error');
      socket.off('newHost');
      socket.off('playerDisconnected');
      socket.off('playerReconnected');
      socket.off('playerRejoined');
      socket.off('updatePlayerStats');
      // ✅ REMOVED triggerPersonalRefresh cleanup - handler removed
    };
  }, []); // 🔧 CRITICAL FIX: Empty dependency - handlers created once, never destroyed during gameplay

  // 🔍 COMPREHENSIVE DEBUG RENDER MODE - bypasses all logic
  if (window.location.search.includes('debugrender')) {
    return (
      <div style={{
        backgroundColor: 'red', 
        color: 'white', 
        fontSize: '20px', 
        padding: '20px',
        minHeight: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        overflow: 'auto'
      }}>
        <h1>🔍 DEBUG RENDER MODE</h1>
        <div>✅ React is rendering</div>
        <div>✅ JavaScript is working</div>
        <div>✅ Component mounted successfully</div>
        <br/>
        <div><strong>Game State:</strong> {gameState || 'undefined'}</div>
        <div><strong>Player Name:</strong> {playerName || 'empty'}</div>
        <div><strong>Room Code:</strong> {roomCode || 'empty'}</div>
        <div><strong>Socket Connected:</strong> {socket.connected ? 'YES' : 'NO'}</div>
        <div><strong>Players Count:</strong> {players?.length || 0}</div>
        <div><strong>Current URL:</strong> {window.location.href}</div>
        <div><strong>Document Ready:</strong> {document.readyState}</div>
        <div><strong>CSS Links Found:</strong> {document.querySelectorAll('link[rel="stylesheet"]').length}</div>
        <div><strong>Style Tags Found:</strong> {document.querySelectorAll('style').length}</div>
        <br/>
        <div>🧪 Add ?debugrender=false to exit this mode</div>
      </div>
    );
  }

  // Debug: Log current render state with enhanced details
  console.log('🖼️ RENDER START - gameState:', gameState, 'playerName:', playerName, 'roomCode:', roomCode);
  console.log('🖼️ Players array:', players);
  console.log('🖼️ Socket state:', { connected: socket.connected, id: socket.id });
  console.log('🖼️ CSS status:', {
    stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
    styleTags: document.querySelectorAll('style').length,
    bodyBg: getComputedStyle(document.body).backgroundColor
  });
  console.log('🖼️ Document:', { 
    readyState: document.readyState, 
    visibility: document.visibilityState,
    bodyClasses: document.body.className 
  });

  // Emergency fallback for debugging
  if (!gameState) {
    console.error('❌ CRITICAL: gameState is undefined/null');
    return <div style={{color: 'red', fontSize: '20px', padding: '20px'}}>EMERGENCY: gameState undefined</div>;
  }

  // TEST: Force render test content to check if it's a CSS issue
  if (window.location.search.includes('debugtest')) {
    return (
      <div style={{
        backgroundColor: 'red', 
        color: 'white', 
        fontSize: '24px', 
        padding: '20px',
        minHeight: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999
      }}>
        DEBUG TEST MODE
        <br />gameState: {gameState}
        <br />playerName: {playerName}
        <br />roomCode: {roomCode}
        <br />Socket connected: {socket.connected ? 'YES' : 'NO'}
        <br />Current URL: {window.location.href}
      </div>
    );
  }

  // ── derived view data ──────────────────────────────────────────────────
  // Avatars are assigned from the player's NAME, so the same person is the
  // same football in every game, and no two players in a room share one while
  // there are 8 or fewer of them.
  // Characters are assigned across the whole roster at once so nobody shares
  // one while there are enough to go round; past that the accent ring keeps
  // repeats apart. Both are derived from the player's name, so a person is the
  // same character in every game.
  const avatarMap = assignAvatars(players);
  const withAvatar = (p) => {
    const a = avatarMap[p.name] || avatarFor(p.name);
    return { ...p, avatar: a.src, avatarRing: a.ring, avatarLabel: a.label };
  };

  const boardPlayers = players.map((player) => {
    const stats = resolvePlayerStats(player, playerStats, players) || {};
    return {
      ...withAvatar(player),
      totalDrinks: stats.totalDrinks || 0,
      totalShotguns: stats.totalShotguns || 0,
      isSelf: player.id === socket.id,
      isRef: player.id === hostId,
    };
  });

  const declaredCardRecord = declaredCard ? getCard(declaredCard) : null;
  const roundDuration = declaredCard === 'First Down'
    ? ROUND_DURATIONS.firstDown
    : declaredCardRecord && declaredCardRecord.deck === DECK.WILD
      ? ROUND_DURATIONS.wild
      : ROUND_DURATIONS.standard;

  // A round can owe BOTH shotguns and drinks — 4x Turnover is 16, which the
  // server splits into {shotguns: 1, drinkCount: 6}. Shotguns go out first and
  // the assigner then rolls over to the drinks. There used to be one pool with
  // no way to switch, so the six drinks could not be poured at all.
  const phase = pourPhase(shotgunsToGive, drinksToGive, assignedDrinks);
  const isShotgunRound = phase.isShotgun;
  const pool = phase.pool;
  const givenMap = assignedDrinks[phase.bucket] || {};
  const pourCount = phase.poured;
  const assignerOpen = timeRemaining > 0 && !!declaredCard;
  // First Down is a GLOBAL event, not a card anybody holds. It is not the same
  // thing as "you don't hold the declared card" and must not use that screen.
  const isFirstDown = declaredCard === 'First Down';
  const isPassive = !isFirstDown && pool <= 0;
  const totalForCard = drinksToGive + shotgunsToGive * DRINKS_PER_SHOTGUN;
  const copiesHeld = declaredCardRecord && declaredCardRecord.drinks
    ? Math.max(1, Math.round(totalForCard / declaredCardRecord.drinks))
    : 1;

  /**
   * Send the taps that have not gone out yet.
   *
   * The payload shape is EXACTLY what the server has always received; only the
   * cadence changes. The server accumulates (`roundResults[...].drinks += ...`),
   * so many small calls land the same total as one big one — and they fold 10
   * into a shotgun more correctly than a single batch does, because the fold
   * re-checks the running total on every call.
   */
  const flushPours = () => {
    const local = localPoursRef.current;
    const delta = pourDeltas(local, sentPoursRef.current);
    if (!delta) return;

    // Record what the server will have BEFORE emitting, so a flush that races
    // a tap cannot send the same drink twice.
    sentPoursRef.current = {
      drinks: { ...local.drinks },
      shotguns: { ...local.shotguns },
    };
    socket.emit('assignDrinks', { roomCode: roomCodeRef.current, ...delta });
  };

  /**
   * Take a pour back, whether or not it has already reached the server.
   *
   * This used to work only inside the flush window — well under a second —
   * because a compensating negative was unsafe: `assignDrinks` folds every ten
   * drinks into a shotgun as it accumulates, so a -1 landing after a fold left
   * the recipient on 1 shotgun and MINUS ONE drinks. The server now borrows
   * the shotgun back, so the negative is safe and undo works all round.
   */
  const undoPour = (playerId, isShotgun) => {
    const bucket = isShotgun ? 'shotguns' : 'drinks';
    const local = localPoursRef.current[bucket];
    if (!local[playerId]) return false;
    local[playerId] -= 1;
    if (local[playerId] <= 0) delete local[playerId];
    return true;
  };

  /** Flash a tile, then clear it so the animation can retrigger next tap. */
  const flashTile = (playerId, kind) => {
    setTileAnim((prev) => ({ ...prev, [playerId]: kind }));
    setTimeout(() => {
      setTileAnim((prev) => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    }, 320);
  };

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 2200);
  };

  /**
   * One tap = one drink (or one shotgun). Refuses past your allowance with a
   * shake rather than silently doing nothing — a dead tap reads as a bug.
   */
  const handleTapTarget = (playerId) => {
    if (pourSent) return;
    if (pourCount >= pool) {
      flashTile(playerId, 'deny');
      return;
    }
    handleGiveDrink(playerId, isShotgunRound ? 'shotgun' : 'drink');
    const bucketName = phase.bucket;
    const bucket = localPoursRef.current[bucketName];
    bucket[playerId] = (bucket[playerId] || 0) + 1;
    // Remember WHICH bucket, so undo can walk back across the phase boundary —
    // it is one debt, and undoing a drink must not hand back a shotgun.
    setPourStack((prev) => [...prev, { playerId, bucket: bucketName }]);
    flashTile(playerId, 'hit');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* not supported */ } }
  };

  const handleUndoPour = () => {
    if (pourSent || pourStack.length === 0) return;
    const last = pourStack[pourStack.length - 1];
    // Older entries were bare ids, before pours carried their bucket.
    const playerId = typeof last === 'string' ? last : last.playerId;
    const key = typeof last === 'string' ? (isShotgunRound ? 'shotguns' : 'drinks') : last.bucket;

    if (!undoPour(playerId, key === 'shotguns')) return;

    setPourStack((prev) => prev.slice(0, -1));
    setAssignedDrinks((prev) => {
      const bucket = { ...(prev[key] || {}) };
      bucket[playerId] = Math.max(0, (bucket[playerId] || 0) - 1);
      if (bucket[playerId] === 0) delete bucket[playerId];
      return { ...prev, [key]: bucket };
    });
  };

  /** Optional early commit. Never required — expiry commits whatever is there. */
  const handleLockIn = () => {
    flushPours();
    setPourSent(true);
    // Tell the server too, so the round can end without waiting out the clock.
    // This used to be purely local, which is why an explicit lock-in could
    // never finish a round early.
    socket.emit('lockIn', { roomCode: roomCodeRef.current });
  };

  const menu = (
    <MenuSheet
      open={isMenuOpen}
      onClose={closeMenu}
      roomCode={roomCode}
      playerCount={players.length}
      maxPlayers={MAX_PLAYERS}
      onRules={handleShowInstructions}
      onLeave={handleLeaveGame}
      onHandOff={isHost ? handleHostSwap : undefined}
      onRemovePlayer={isHost ? openRemovePlayer : undefined}
      onEndGame={isHost ? handleEndGame : undefined}
      soundOn={soundOn}
      onToggleSound={toggleSound}
      shareSlot={
        /**
         * A game runs long and the best moment is often not the end — it is
         * somebody taking ten drinks in a round. Every player can share the
         * standings as they stand, from here, at any time.
         *
         * `title: 'RIGHT NOW'` rather than FINAL, and deliberately NO
         * timestamp or quarter label: it will be posted five minutes later
         * either way, and a stale clock on the image is worse than no clock.
         */
        gameState === 'game' && boardPlayers.length > 0 ? (
          <ShareResult
            players={boardPlayers}
            roomCode={roomCode}
            size="story"
            title="RIGHT NOW"
            label="Share the score"
          />
        ) : null
      }
    />
  );

  // One at a time, oldest first, each needing its own tap. Rendered above every
  // screen — `newHost` and `gameOver` can land in the lobby as easily as
  // mid-game, and the old alert() was not screen-specific either.
  const announcement = announcements.length > 0 ? (
    <Announcement
      open
      title={announcements[0].title}
      body={announcements[0].body}
      dismissText={announcements[0].dismissText}
      onDismiss={dismissAnnouncement}
    />
  ) : null;

  const removePlayerSheet = isHost ? (
    <RemovePlayerSheet
      open={isRemovePlayerOpen}
      players={players}
      selfId={socket.id}
      onClose={() => setIsRemovePlayerOpen(false)}
      onRemove={handleRemovePlayer}
    />
  ) : null;

  /**
   * ── WHERE THE GATE SITS, and why ──────────────────────────────────────
   *
   * In App, in front of ENTERING A ROOM — not in index.js around <App/>, and
   * not inside JoinScreen.
   *
   *  - `index.js` would gate the LANDING PAGE, which the brief forbids. It
   *    would leave /how-to-play untouched, but at the cost of walling off the
   *    front door to everyone who has never played.
   *  - `JoinScreen` alone would gate the form but not the ACTIONS, and the
   *    form is also what someone sees before they have decided to play.
   *
   * So: /how-to-play is exempt BY CONSTRUCTION — it never mounts <App/> at all
   * (index.js picks by pathname), so no variant of it can show this. The bare
   * landing page is not gated either. The gate fires on an act to enter a
   * room: tapping Create or Join, or ARRIVING on a ?room= link, which is an
   * act to enter even though it lands on the join screen rather than a game.
   *
   * It is scoped to `gameState === 'initial'`, so it can never appear
   * mid-game or on a reconnect — a gate firing at 11pm on a dropped phone
   * would lose that player permanently.
   */
  const arrivedOnRoomLink = roomCodeFromSearch(
    typeof window === 'undefined' ? '' : window.location.search,
  ) !== '';

  if (gameState === 'initial' && !ageOk && (arrivedOnRoomLink || afterGate)) {
    return (
      <AgeGate
        onPass={() => {
          unlockOnGesture();
          rememberAge();
          setAgeOk(true);
          const next = afterGate;
          setAfterGate(null);
          if (next === 'create') startGame();
          if (next === 'join') joinGame();
        }}
      />
    );
  }

  /** Run `what` now, or hold it behind the gate. */
  const gated = (what, run) => () => {
    // A tap is a tap: unlock audio here whether or not the gate intervenes.
    unlockOnGesture();
    if (ageOk) { run(); return; }
    setAfterGate(what);
  };

  // ── initial ────────────────────────────────────────────────────────────
  if (gameState === 'initial') {
    // True only when the link actually carried a usable code. It now drives
    // the button wording and where the cursor lands — NOT whether the room
    // field is editable. Making it read-only was half of why an invited player
    // could not get in at all.
    const hasSharedRoomCode = roomCodeFromSearch(window.location.search) !== '';
    return (
      <>
        <AnnouncementBanner
          announcement={banner}
          onDismiss={() => { if (banner) { dismissAnnouncementId(banner.id); setBanner(null); } }}
        />
        <JoinScreen
          playerName={playerName}
          onPlayerName={setPlayerName}
          roomCode={roomCode}
          onRoomCode={(v) => { setRoomCode(v); setErrorMessage(''); }}
          onCreate={gated('create', startGame)}
          onJoin={gated('join', joinGame)}
          hasSharedRoomCode={hasSharedRoomCode}
          errorMessage={errorMessage}
        />
        {announcement}
      </>
    );
  }

  // ── connecting ─────────────────────────────────────────────────────────
  if (gameState === 'connecting') {
    return (
      <>
        <ConnectingScreen roomCode={roomCode} onGiveUp={abandonRejoin} />
        {announcement}
      </>
    );
  }

  // ── lobby ──────────────────────────────────────────────────────────────
  if (gameState === 'lobby') {
    return (
      <>
        <LobbyScreen
          roomCode={roomCode}
          players={players.map(withAvatar)}
          isHost={isHost}
          canStart={players.length >= MIN_PLAYERS}
          minPlayers={MIN_PLAYERS}
          onStart={startTheGame}
          onLeave={leaveLobby}
          onShare={handleInvite}
        />
        {announcement}
      </>
    );
  }

  // ── game over ──────────────────────────────────────────────────────────
  if (gameState === 'over') {
    return (
      <>
        <GameOverScreen
          standings={finalStandings || []}
          roomCode={roomCode}
          isHost={isHost}
          onPlayAgain={isHost ? handlePlayAgain : undefined}
          onLeave={handleLeaveGame}
        />
        {announcement}
      </>
    );
  }

  // ── game ───────────────────────────────────────────────────────────────
  if (gameState === 'game') {
    const me = players.find((p) => p.id === socket.id);
    const hand = (me && me.cards) ? me.cards : { standard: [], wild: [] };
    const targets = boardPlayers.filter((p) => p.id !== socket.id);

    return (
      <>
        <GameScreen
          /**
           * The result card sits with the standings once there is a result to
           * share. Session 18 asked for it "at game end" — there is no
           * game-end SCREEN in this app (`gameOver` announces and returns
           * everyone to the join screen), so the honest place is beside the
           * standings, from the moment they mean anything. Games more often
           * fizzle out than formally end, and this way the card is there
           * either way.
           */
          boardExtra={
            boardPlayers.some((p) => (p.totalDrinks || 0) > 0 || (p.totalShotguns || 0) > 0)
              ? <ShareResult players={boardPlayers} roomCode={roomCode} />
              : null
          }
          quarter={quarter}
          roomCode={roomCode}
          onMenu={toggleMenu}
          players={boardPlayers}
          boardTab={boardTab}
          onBoardTab={(t) => { setBoardTab(t); setBoardPulse(false); setBoardPinned(true); }}
          boardPulse={boardPulse}
          lastRoundCardId={lastRoundCard}
          lastRoundRows={lastRoundRows}
          selfId={socket.id}
          hand={hand}
          onCardTap={(card) => setOpenCard(card)}
          isHost={isHost}
          onDeclare={handleDeclareAction}
          noCardMessage={noCardMessage || actionMessage}
          watching={watching}
          onWatchGame={isHost ? () => openPicker() : undefined}
          onDetachGame={isHost ? handleDetachGame : undefined}
          callEntries={callEntries}
          callFeedOpen={callFeedOpen}
          onCallFeedToggle={() => setCallFeedOpen((v) => !v)}
          autoCallPaused={autoCallPaused}
          feedNotice={feedNotice}
          onOpenDial={isHost ? () => setDialOpen(true) : undefined}
          suggestion={isHost ? (suggestions[0] || null) : null}
          suggestionQueued={Math.max(0, suggestions.length - 1)}
          onAcceptSuggestion={handleAcceptSuggestion}
          onSkipSuggestion={handleSkipSuggestion}
        />

        {dialOpen && (
          <div className="assigner-overlay">
            <CardDial
              modes={cardModes}
              defaults={cardDefaults}
              paused={autoCallPaused}
              onPause={handlePauseAutoCall}
              onMode={handleCardMode}
              onClose={() => setDialOpen(false)}
            />
          </div>
        )}

        {pickerOpen && (
          <div className="assigner-overlay">
            <GamePicker
              league={pickerLeague}
              games={gameList}
              loading={gameListLoading}
              error={gameListError}
              query={pickerQuery}
              onlyRanked={pickerRanked}
              onQuery={setPickerQuery}
              onOnlyRanked={setPickerRanked}
              onLeague={requestGames}
              onPick={handlePickGame}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}

        {assignerOpen && (
          <div className="assigner-overlay">
            <DrinkAssigner
              card={declaredCardRecord}
              copies={copiesHeld}
              watching={watching}
              source={sourceLine(
                roundSource,
                Boolean(declaredCardRecord && declaredCardRecord.deck === DECK.WILD)
              )}
              secondsLeft={timeRemaining}
              fraction={timeRemaining / roundDuration}
              tier={declaredCardRecord ? tierFor(declaredCardRecord) : 'amber'}
              passive={isPassive}
              firstDown={isFirstDown}
              targets={targets}
              given={givenMap}
              pourCount={pourCount}
              pool={pool}
              isShotgun={isShotgunRound}
              unit={phase.unit}
              rolledOver={phase.rolledOver}
              shotgunsOwed={phase.shotgunsOwed}
              drinksOwed={phase.drinksOwed}
              sent={pourSent}
              animations={tileAnim}
              onGive={handleTapTarget}
              onUndo={handleUndoPour}
              onLockIn={handleLockIn}
            />
          </div>
        )}

        {/* Tapping a hand card opens it full size. A WILD card is also how you
            call an event: the Ref then confirms it. */}
        <CardSheet
          card={openCard}
          onClose={() => setOpenCard(null)}
          actionLabel={openCard && openCard.deck === DECK.WILD && !declaredCard ? 'Call it' : null}
          onAction={() => { handleWildCardSelect(openCard.id); setOpenCard(null); }}
        />
        {menu}
        {removePlayerSheet}
        {announcement}
        <Toast message={toastMessage} />

        {/* Declare Action — the Ref picks what just happened on the TV.
            Buttons come from cards.js DECLARABLE; no card name is written here. */}
        {isActionModalOpen && (
          <>
            <div className="scrim on" onClick={() => closeModal('actionModal')} />
            <div className="sheet on" role="dialog" aria-label="Declare action" aria-modal="true">
              <div className="grab" />
              {DECLARABLE.map((card) => (
                <button
                  type="button" className="mi" key={card.id}
                  onClick={() => handleCardClick(card.id)}
                >
                  {card.label}
                  <span className="k">
                    {card.isGlobalEvent ? 'EVERYONE' : `${card.drinks} ${card.drinks === 1 ? 'DRINK' : 'DRINKS'}`}
                  </span>
                </button>
              ))}
              <button type="button" className="mi" onClick={handleNextQuarter}>
                End quarter <span className="k">Q{quarter} → Q{quarter + 1}</span>
              </button>
              {/* Backing out must not declare anything or start a round. */}
              <button type="button" className="mi" onClick={() => closeModal('actionModal')}>
                Never mind
              </button>
            </div>
          </>
        )}

        {/* Wild card confirmation — a player called it, the Ref confirms */}
        {wildCardSelected && isHost && (
          <>
            <div className="scrim on" />
            <div className="sheet on" role="dialog" aria-label="Confirm wild card" aria-modal="true">
              <div className="grab" />
              <p className="waiting">
                {(players.find((p) => p.id === wildCardSelected.playerId) || {}).name || 'A player'}
                {' '}called <b>{wildCardSelected.wildcardtype}</b>
              </p>
              <button type="button" className="mi" onClick={() => confirmWildCard(true)}>Confirm</button>
              <button type="button" className="mi" onClick={() => confirmWildCard(false)}>Reject</button>
            </div>
          </>
        )}

        {/* Wild card swap, once per quarter */}
        {isWildCardSelectionOpen && (
          <>
            <div className="scrim on" />
            <div className="sheet on cardsheet" role="dialog" aria-label="Shed your duplicates" aria-modal="true">
              <div className="grab" />
              {/* Shedding redundancy, not rerolling. Only cards held more than
                  once appear here, and one copy of each is always kept, so the
                  count under each card is what you may give up — never all of
                  them. Tapping cycles through 0..spare and back to 0, which is
                  what makes a mis-tap recoverable. */}
              {(() => {
                const groups = swappableGroups(hand);
                if (groups.length === 0) {
                  return (
                    <>
                      <p className="waiting">
                        Nothing to shed — you are not holding any card twice.
                      </p>
                      <button type="button" className="mi" onClick={dismissSwap}>
                        Carry on
                      </button>
                    </>
                  );
                }
                const picked = totalSelected(swapSelection);
                return (
                  <>
                    <p className="waiting">
                      Quarter break — swap any card you are holding more than once.
                      Tap again to change your mind.
                    </p>
                    <div className="cardsheet-card" style={{ gap: 10 }}>
                      {groups.map((group) => {
                        const card = getCard(group.card && group.card.card);
                        if (!card) return null;
                        const n = selectedCount(swapSelection, group);
                        return (
                          <div
                            key={groupKey(group)}
                            className={`dupepick${n > 0 ? ' on' : ''}`}
                            style={{ outline: n > 0 ? '2px solid var(--sf-amber)' : 'none', borderRadius: 12 }}
                          >
                            <GameCard card={card} onClick={() => toggleSwapCard(group)} />
                            <span className="dupecount">
                              holding {group.held} · swapping {n} of {group.spare}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" className="mi" onClick={confirmSwap} disabled={picked === 0}>
                      {picked === 0 ? 'Pick what to swap' : `Swap ${picked} card${picked === 1 ? '' : 's'}`}
                    </button>
                    <button type="button" className="mi" onClick={dismissSwap}>Keep my hand</button>
                  </>
                );
              })()}
            </div>
          </>
        )}

        {/* The Ref turning the quarter over when something disagrees. Only two
            things are worth interrupting for: a round is running, or the game
            being watched is on a different quarter. */}
        {quarterWarning ? (
          <>
            <div className="scrim on" onClick={() => setQuarterWarning(null)} />
            <div className="sheet on" role="dialog" aria-label="Advance the quarter?" aria-modal="true">
              <div className="sheet-head">
                <span className="t">Advance the quarter?</span>
                <button type="button" className="x" onClick={() => setQuarterWarning(null)} aria-label="Close">×</button>
              </div>
              {quarterWarning.map((line) => (
                <p className="waiting" key={line}>{line}</p>
              ))}
              <button type="button" className="mi mi-remove" onClick={forceNextQuarter}>
                Advance anyway
              </button>
              <button type="button" className="mi" onClick={() => setQuarterWarning(null)}>
                Not yet
              </button>
            </div>
          </>
        ) : null}

        {/* Host hand-off */}
        {isHostSelection && (
          <>
            <div className="scrim on" onClick={closeHostSelection} />
            <div className="sheet on" role="dialog" aria-label="Select a new Ref" aria-modal="true">
              <div className="grab" />
              <p className="waiting">Hand the whistle to</p>
              {/* Everyone is listed. Away players are shown greyed and
                  labelled rather than hidden: filtering them out reads as
                  "they left the game" when they have not — they still hold
                  their seat and their drinks. They are not clickable, and the
                  server refuses them anyway. */}
              {(() => {
                const others = players.filter((p) => p.id !== socket.id);
                if (others.length === 0) {
                  return <p className="waiting">Nobody else is in the game yet.</p>;
                }
                if (others.every((p) => p.disconnected)) {
                  return (
                    <>
                      <p className="waiting">
                        Everyone else is away right now. Wait for someone to come back.
                      </p>
                      {others.map((player) => (
                        <button type="button" className="mi away" key={player.id} disabled>
                          {player.name} <span className="k">AWAY</span>
                        </button>
                      ))}
                    </>
                  );
                }
                return others.map((player) => (
                  <button
                    type="button"
                    className={`mi${player.disconnected ? ' away' : ''}`}
                    key={player.id}
                    disabled={!!player.disconnected}
                    onClick={player.disconnected ? undefined : () => handleSelectNewHost(player.id)}
                  >
                    {player.name}
                    {player.disconnected ? <span className="k">AWAY</span> : null}
                  </button>
                ));
              })()}
              {errorMessage ? <p className="err">{errorMessage}</p> : null}
              <button type="button" className="mi" onClick={closeHostSelection}>Cancel</button>
            </div>
          </>
        )}
      </>
    );
  }

  // CRITICAL FIX: Never return null - this causes white screen!
  // If we reach here, gameState is invalid. Force back to initial state.
  console.error('❌ CRITICAL WHITE SCREEN BUG: Invalid gameState reached end of render:', gameState);
  console.error('❌ playerName:', playerName, 'roomCode:', roomCode);
  console.error('❌ Socket connected:', socket.connected);
  console.error('❌ Forcing gameState back to initial to prevent white screen');
  
  // Reset to initial state to recover
  setTimeout(() => {
    setGameState('initial');
    setErrorMessage('Connection issue detected - please rejoin your game');
  }, 100);
  
  // Return emergency fallback instead of null
  return (
    <div style={{
      backgroundColor: '#1a1a1a',
      color: '#ff6b35',
      fontSize: '18px',
      padding: '20px',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <h2>🔧 Connection Recovery</h2>
      <p>Detected invalid game state: {gameState}</p>
      <p>Automatically redirecting you back to the start...</p>
      <div style={{marginTop: '20px'}}>
        <button 
          onClick={() => {
            setGameState('initial');
            clearURL();  // Clear URL when recovering from invalid state
            setErrorMessage('Please rejoin your game');
          }}
          style={{
            padding: '12px 24px',
            backgroundColor: '#ff6b35',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          Return to Start
        </button>
      </div>
    </div>
  );
}

// Wrap App with ErrorBoundary to prevent crashes
const AppWithErrorBoundary = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;

