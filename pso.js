var nj = require("numjs");

const W = 0.5;
const c1 = 0.8;
const c2 = 0.9;

// particle class
class Particle {
  constructor(args) {
    const { id, alpha, y, size } = args;
    this.id = id;
    this.position = nj.array([alpha, y]);
    this.pbest_position = this.position.clone();
    this.pbest_value = Infinity;
    this.velocity = nj.array([0, 0]);
    this.size = size;
  }
  // actual state particle
  particleState = () => {
    console.log(
      "I am at ",
      JSON.stringify(this.position.tolist()),
      " my pbest is ",
      JSON.stringify(this.pbest_position.tolist())
    );
  };
  //update particle position
  move() {
    const newPosition = this.position.add(this.velocity);
    this.position = newPosition;
  }
}

// Space Class
class Space {
  constructor(target, target_error, particles) {
    this.target = target;
    this.target_error = target_error;
    this.n_particles = particles.length;
    this.particles = particles; // Assign the passed particles array directly
    this.gbest_value = 0;
    this.gbest_position = nj.array([Math.random() * 100, Math.random() * 100]);
  }

  //display all particles
  displayParticles = () => {
    this.particles.forEach((particle) => {
      particle.particleState();
    });
  };

  // our optimization function
  fitness(particle) {
    return particle.position.get(0) + particle.position.get(1) + 1;
  }

  setPbest() {
    this.particles.forEach((particle) => {
      let fitness_candidate = this.fitness(particle);
      if (fitness_candidate < particle.pbest_value) {
        particle.pbest_value = fitness_candidate;
        particle.pbest_position = particle.position.clone();
      }
    });
  }

  setGbest() {
    this.particles.forEach((particle) => {
      let best_fitness_candidate = this.fitness(particle);
      if (best_fitness_candidate < this.gbest_value || this.gbest_value === 0) {
        this.gbest_value = best_fitness_candidate;
        this.gbest_position = particle.position.clone();
      }
    });
  }

  moveParticles() {
    this.particles.forEach((particle) => {
      let new_velocity = particle.velocity
        .multiply(W)
        .add(
          nj
            .array([
              c1 *
                Math.random() *
                (particle.pbest_position.get(0) - particle.position.get(0)),
              c1 *
                Math.random() *
                (particle.pbest_position.get(1) - particle.position.get(1)),
            ])
            .add(
              nj.array([
                c2 *
                  Math.random() *
                  (this.gbest_position.get(0) - particle.position.get(0)),
                c2 *
                  Math.random() *
                  (this.gbest_position.get(1) - particle.position.get(1)),
              ])
            )
        );
      particle.velocity = new_velocity;
      particle.move();
    });
  }
}

const pso = (
  target_error,
  particles,
  list_eliminator_ratio,
  n_head_lists,
  current_blockchain_size
) => {
  console.log(
    "Initial parameters:",
    target_error,
    particles,
    list_eliminator_ratio,
    n_head_lists,
    current_blockchain_size
  );

  const particles_vector = particles.map((currentValue) => {
    return new Particle(currentValue);
  });
  console.log("Final particles_vector:", particles_vector);

  const search_space = new Space(Infinity, target_error, particles_vector);
  console.log("Created search_space:", search_space);

  console.log("Set search_space particles:", search_space.particles);

  search_space.displayParticles();
  console.log("Displayed particles");

  let iteration = 0;
  let currentBestParticle = null;

  while (iteration < n_head_lists) {
    console.log(`Iteration: ${iteration}`);

    currentBestParticle = particles.filter(
      (element) =>
        element.pbest_position &&
        nj.array(element.pbest_position.tolist()).toString() ===
          search_space.gbest_position.toString()
    );
    console.log("Current best particle:", currentBestParticle);

    search_space.setPbest();
    console.log("Set Pbest");

    search_space.setGbest();
    console.log("Set Gbest");

    if (
      Math.abs(search_space.gbest_value - search_space.target) <=
      search_space.target_error
    ) {
      console.log("Stopping criteria met");
      break;
    }

    // Evaluate pruning list in terms of size gain
    if (
      currentBestParticle.length > 0 &&
      currentBestParticle[0].size / current_blockchain_size >
        list_eliminator_ratio
    ) {
      const newlist = particles.filter(
        (element) =>
          element.pbest_position &&
          nj.array(element.pbest_position.tolist()).toString() !==
            search_space.gbest_position.toString()
      );
      search_space.particles = newlist;
      console.log("Updated search_space particles after pruning:", newlist);
    }

    search_space.moveParticles();
    console.log("Moved particles");

    iteration += 1;
  }

  const result = search_space?.gbest_position
    ? particles.find(
        (item) =>
          search_space?.gbest_position.get(0) === item.alpha &&
          search_space?.gbest_position.get(1) === item.y
      )
    : null;
  console.log("Result:", result);

  return result;
};

module.exports = pso;
